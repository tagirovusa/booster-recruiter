"""The recruiter sees short Russian sentences, never engine internals."""

import asyncio
import json

import httpx
import pytest
from booster_recruiter import user_errors
from booster_recruiter.api import create_app
from booster_recruiter.runtime import Runtime
from booster_recruiter.store import AppError, Store
from test_store import prepared

RAW_ENGINE_FAILURE = json.dumps(
    {
        "message": "The browser stopped unexpectedly and was shut down. Run the tool again to start a new browser.\n\nDiagnostics:\n- Local diagnostic notes: "
        + "/"
        + "Users/someone/Library/trace.md",
        "meta": {"linkedin.dev/error": {"code": "browser_closed"}},
    }
)


def assert_readable(text):
    assert user_errors.is_user_text(text), text
    assert "Users" + "/" not in text and "{" not in text


@pytest.mark.parametrize(
    "raw, expected",
    [
        (RAW_ENGINE_FAILURE, user_errors.BROWSER_CLOSED),
        ("Timeout 30000ms exceeded.", user_errors.BROWSER_TIMEOUT),
        ("net::ERR_INTERNET_DISCONNECTED at https://x", user_errors.NETWORK),
        (
            "That is not a LinkedIn public identifier",
            user_errors.BAD_PROFILE_LINK,
        ),
        ("'NoneType' object is not subscriptable", user_errors.GENERIC),
        ("Unknown worker command", user_errors.GENERIC),
    ],
)
def test_technical_text_becomes_a_russian_sentence(raw, expected):
    assert user_errors.user_text(raw, log=False) == expected
    assert_readable(expected)


def test_russian_messages_pass_through_and_details_are_trimmed():
    plain = "Аккаунт не готов. Выполните вход."
    assert user_errors.user_text(plain) == plain
    assert (
        user_errors.user_text('LinkedIn не отдал раздел профиля: {"main": "boom"}')
        == "LinkedIn не отдал раздел профиля."
    )


def test_raw_text_is_kept_in_the_local_log(tmp_path):
    user_errors.configure(tmp_path)
    try:
        user_errors.user_text(RAW_ENGINE_FAILURE)
        assert "browser stopped" in (tmp_path / "errors.log").read_text(
            encoding="utf-8"
        )
    finally:
        user_errors._LOG = None


def test_friendly_never_returns_engine_json():
    assert Runtime.friendly(RuntimeError(RAW_ENGINE_FAILURE)) == (
        user_errors.BROWSER_CLOSED
    )


def test_stored_raw_progress_is_cleaned_on_display(tmp_path):
    store = Store(tmp_path)
    try:
        _, c, _ = prepared(store)
        store.progress(c["id"], "paused", RAW_ENGINE_FAILURE)
        store.event("collection_stopped", f"{c['id']}: {RAW_ENGINE_FAILURE}")
        store.event("delivery_reconciled", "Existing unknown delivery confirmed.")
        state = store.state()
        shown = next(x for x in state["campaigns"] if x["id"] == c["id"])
        assert shown["progress"] == user_errors.BROWSER_CLOSED
        assert store.detail(c["id"])["campaign"]["progress"] == (
            user_errors.BROWSER_CLOSED
        )
        for event in state["events"][:2]:
            assert "{" not in event["detail"] and "Existing" not in event["detail"]
        # The stored row stays untouched for diagnosis.
        assert store.campaign(c["id"])["progress"] == RAW_ENGINE_FAILURE
    finally:
        store.db.close()


async def test_api_hides_key_and_type_errors(tmp_path):
    store = Store(tmp_path)
    app = create_app(store, Runtime(store), "secret")
    try:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            response = await client.post(
                "/command",
                json={"op": "campaign.detail", "params": {}},
                headers={"Authorization": "Bearer secret"},
            )
        assert response.status_code == 400
        assert_readable(response.json()["error"])
    finally:
        store.db.close()


async def test_busy_browser_names_the_campaign(tmp_path):
    store = Store(tmp_path)
    a, c, _ = prepared(store)
    runtime = Runtime(store)
    task = asyncio.current_task()
    await runtime.browser_lock.acquire()
    runtime.campaign_operations[c["id"]] = task
    runtime.active_campaign_tasks.add(task)
    try:
        with pytest.raises(AppError, match="Браузер занят кампанией"):
            runtime.ensure_browser_free()
    finally:
        runtime.browser_lock.release()
        store.db.close()


async def test_failed_campaign_task_does_not_stay_running(tmp_path):
    store = Store(tmp_path)
    _, c, _ = prepared(store)
    runtime = Runtime(store)

    async def broken():
        raise RuntimeError(RAW_ENGINE_FAILURE)

    try:
        runtime.start_campaign(c["id"], broken(), "sending")
        await asyncio.gather(runtime.jobs[c["id"]], return_exceptions=True)
        await asyncio.sleep(0)
        campaign = store.campaign(c["id"])
        assert campaign["status"] == "paused"
        assert campaign["progress"] == user_errors.BROWSER_CLOSED
    finally:
        store.db.close()


def test_restart_does_not_invent_a_queue_for_a_read_only_check(tmp_path):
    store = Store(tmp_path)
    _, c, _ = prepared(store)
    store.progress(c["id"], "checking", "Проверяем контакты…")
    store.db.close()
    store = Store(tmp_path)
    try:
        campaign = store.campaign(c["id"])
        assert campaign["status"] == "ready"
        assert "очередь" not in campaign["progress"]
    finally:
        store.db.close()

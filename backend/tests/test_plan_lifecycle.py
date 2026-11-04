"""Lifecycle decisions against synthetic workspaces; no account or browser access."""

import sqlite3
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import httpx
import pytest
from booster_recruiter.api import create_app
from booster_recruiter.outreach import DEFAULT_RULES
from booster_recruiter.runtime import Runtime
from booster_recruiter.store import AppError, Store, now
from test_outreach import Worker, activate, plan
from test_store import prepared


@pytest.fixture
def store(tmp_path):
    value = Store(tmp_path)
    yield value
    value.db.close()


@pytest.mark.parametrize("status", ["active", "paused", "legacy"])
def test_preview_preserves_approved_work_until_valid_replacement(store, status):
    _, c, _ = prepared(store)
    if status == "legacy":
        original = store.preview(c["id"])
        store.approve(original["batch_id"], original["digest"])

        def original_status():
            return store.one(
                "SELECT status FROM batches WHERE id=?", (original["batch_id"],)
            )["status"]

        expected = "approved"
    else:
        original = store.outreach.preview(c["id"])
        store.outreach.approve(original["run_id"], original["digest"])
        store.outreach.status(original["run_id"], status)

        def original_status():
            return store.outreach.run(original["run_id"])["status"]

        expected = status
    progress = store.campaign(c["id"])
    preview = store.outreach.preview(c["id"])
    assert original_status() == expected
    assert store.campaign(c["id"]) == progress
    with pytest.raises(AppError, match="устарел"):
        store.outreach.approve(preview["run_id"], "incorrect")
    assert original_status() == expected
    replacement = store.outreach.preview(c["id"])
    with pytest.raises(AppError, match="устарел"):
        store.outreach.approve(preview["run_id"], preview["digest"])
    assert original_status() == expected
    store.outreach.approve(replacement["run_id"], replacement["digest"])
    assert original_status() == "cancelled"
    assert store.outreach.run(replacement["run_id"])["status"] == "active"
    assert store.rows("SELECT * FROM outreach_actions") == []
    assert store.claim(original.get("batch_id", "none")) is None


def test_failed_approval_rolls_back_replacement_and_keeps_legacy_queue(store):
    _, c, _ = prepared(store)
    legacy = store.preview(c["id"])
    store.approve(legacy["batch_id"], legacy["digest"])
    preview = store.outreach.preview(c["id"])
    store.db.execute(
        "CREATE TEMP TRIGGER reject_activation BEFORE UPDATE OF status ON outreach_runs WHEN NEW.status='active' BEGIN SELECT RAISE(ABORT,'synthetic write failure'); END"
    )
    with pytest.raises(sqlite3.IntegrityError):
        store.outreach.approve(preview["run_id"], preview["digest"])
    assert store.outreach.run(preview["run_id"])["status"] == "preview"
    assert (
        store.one("SELECT status FROM batches WHERE id=?", (legacy["batch_id"],))[
            "status"
        ]
        == "approved"
    )
    assert (
        store.claim(legacy["batch_id"])["message"] == legacy["messages"][0]["message"]
    )


@pytest.mark.parametrize("mutation", ["suppressed", "inflight", "disconnected"])
def test_rejected_replacement_keeps_existing_run(store, mutation):
    a, c, p, old, _, _ = activate(store)
    preview = store.outreach.preview(c["id"])
    if mutation == "suppressed":
        store.suppress(p["url"], "No contact")
    elif mutation == "inflight":
        store.outreach.reserve(old["messages"][0]["id"], "invite")
    else:
        store.set_account(a["id"], "disconnected")
    with pytest.raises(AppError):
        store.outreach.approve(preview["run_id"], preview["digest"])
    assert store.outreach.run(old["run_id"])["status"] == "active"


@pytest.mark.parametrize("status", ["active", "paused", "legacy"])
def test_idempotent_edits_preserve_approval_and_progress(store, status):
    _, c, p = prepared(store)
    if status == "legacy":
        preview = store.preview(c["id"])
        store.approve(preview["batch_id"], preview["digest"])
    else:
        preview = store.outreach.preview(c["id"])
        store.outreach.approve(preview["run_id"], preview["digest"])
        store.outreach.status(preview["run_id"], status)
    before = store.detail(c["id"])
    store.review(p["id"], "open", True, False)
    store.templates(c["id"], c["template_open"], c["template_neutral"])
    store.outreach.configure(c["id"], {})
    assert store.select_many(c["id"], [p["id"], p["id"]], True)["changed"] == 0
    assert not store.save_automation(
        c["id"], {}, c["template_open"], c["template_neutral"]
    )["changed"]
    assert store.detail(c["id"]) == before


@pytest.mark.parametrize(
    "operation", ["review", "templates", "configure", "bulk", "combined"]
)
def test_real_edit_invalidates_once_and_clears_old_running_progress(
    store, operation, monkeypatch
):
    _, c, p, preview, _, _ = activate(store)
    store.progress(c["id"], "waiting", "Waiting for acceptance")
    calls = []
    original = store.invalidate

    def invalidate(*args, **kwargs):
        calls.append(args)
        return original(*args, **kwargs)

    monkeypatch.setattr(store, "invalidate", invalidate)
    {
        "review": lambda: store.review(p["id"], "neutral", True),
        "templates": lambda: store.templates(c["id"], "New text", "Neutral"),
        "configure": lambda: store.outreach.configure(c["id"], {}),
        "bulk": lambda: store.select_many(c["id"], [p["id"]], False),
        "combined": lambda: store.save_automation(c["id"], {}, "New text", "Neutral"),
    }[operation]()
    assert len(calls) == 1
    assert store.outreach.run(preview["run_id"])["status"] == "cancelled"
    assert store.campaign(c["id"])["status"] == "paused"
    assert "План остановлен" in store.campaign(c["id"])["progress"]


@pytest.mark.parametrize(
    "bad", ["missing", "foreign", "blocked", "excluded", "review", "bad_type"]
)
def test_bulk_selection_is_all_or_nothing(store, bad):
    _, c, p, preview, _, _ = activate(store)
    store.add_candidate(c["id"], {"url": "new-person", "name": "New Person"})
    new = next(p for p in store.detail(c["id"])["candidates"] if not p["selected"])
    ids = [new["id"]]
    if bad == "foreign":
        _, _, other = prepared(store, url="foreign-person")
        ids.append(other["id"])
    elif bad == "missing":
        ids.append("missing")
    elif bad == "bad_type":
        ids.append(None)
    elif bad == "blocked":
        store.suppress(new["url"], "No contact")
    else:
        with store.db:
            store.db.execute(
                "UPDATE candidates SET excluded=?,segment=? WHERE id=?",
                (
                    int(bad == "excluded"),
                    "review" if bad == "review" else "neutral",
                    new["id"],
                ),
            )
    before = store.detail(c["id"])
    with pytest.raises(AppError):
        store.select_many(c["id"], ids, True)
    assert store.detail(c["id"]) == before
    assert store.outreach.run(preview["run_id"])["status"] == "active"


@pytest.mark.parametrize(
    "field,value",
    [
        ("rules", {"daily_invites": 0}),
        ("rules", None),
        ("template_open", None),
        ("template_neutral", "x" * 4001),
    ],
)
async def test_combined_api_invalid_input_keeps_all_settings_and_approval(
    store, field, value
):
    _, c, _, _, _, _ = activate(store)
    params = {
        "id": c["id"],
        "rules": DEFAULT_RULES,
        "template_open": "Changed",
        "template_neutral": "Changed",
    }
    params[field] = value
    before = store.detail(c["id"])
    app = create_app(store, Runtime(store, Worker), "test-token")
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post(
            "/command",
            headers={"Authorization": "Bearer test-token"},
            json={"op": "campaign.save_automation", "params": params},
        )
    assert response.status_code == 400
    assert store.detail(c["id"]) == before


async def test_invitation_remains_eligible_only_for_same_campaign_and_sender(store):
    _, c, p, old, rt, worker = activate(store)
    await rt.outreach.process(old["run_id"])
    own = store.detail(c["id"])["candidates"][0]
    assert own["outreach_eligible"] and own["outreach_exclusion"] == ""
    _, other, _ = prepared(store)
    duplicate = store.detail(other["id"])["candidates"][0]
    assert not duplicate["outreach_eligible"] and duplicate["outreach_exclusion"]
    preview = store.outreach.preview(c["id"])
    assert (
        store.detail(c["id"])["candidates"][0]["outreach_member"]["run_id"]
        == old["run_id"]
    )
    store.outreach.approve(preview["run_id"], preview["digest"])
    with pytest.raises(AppError, match="уже отправлено"):
        store.outreach.reserve(preview["messages"][0]["id"], "invite")
    worker.observation.update(
        relationship="connected", free_message=True, can_invite=False
    )
    await rt.outreach.process(preview["run_id"])
    assert len(worker.actions) == 2
    assert not store.detail(c["id"])["candidates"][0]["outreach_eligible"]


@pytest.mark.parametrize("outcome", ["sent", "replied"])
def test_cancelled_unused_plan_does_not_hide_substantive_history(store, outcome):
    _, c, _, old, _, _ = activate(store)
    preview = store.outreach.preview(c["id"])
    mid = old["messages"][0]["id"]
    action = store.outreach.reserve(mid, "message")
    store.outreach.finish(action, "sent", "Confirmed")
    store.outreach.update_member(
        mid,
        status=outcome,
        sent_at=now(),
        reply_text="Thanks" if outcome == "replied" else "",
    )
    store.templates(c["id"], "Changed", "Changed")
    person = store.detail(c["id"])["candidates"][0]
    assert person["outreach_member"]["id"] == mid
    assert person["outreach_member"]["status"] == outcome
    assert person["outreach_member"]["run_status"] == "cancelled"
    assert not person["outreach_eligible"]
    assert store.outreach.run(preview["run_id"])["status"] == "cancelled"


def test_concurrent_approvals_cannot_reserve_same_profile_twice(store):
    _, _, _, a = plan(store)
    _, _, _, b = plan(store)
    barrier = Barrier(2)

    def approve(preview):
        other = Store(store.root)
        try:
            barrier.wait(timeout=5)
            try:
                other.outreach.approve(preview["run_id"], preview["digest"])
                return True
            except AppError:
                return False
        finally:
            other.db.close()

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(approve, [a, b])) == [False, True]
    assert len(store.rows("SELECT id FROM outreach_runs WHERE status='active'")) == 1


def test_concurrent_reservations_dispatch_at_most_once(store):
    _, _, _, preview, _, _ = activate(store)
    barrier = Barrier(2)

    def reserve(_):
        other = Store(store.root)
        try:
            barrier.wait(timeout=5)
            try:
                other.outreach.reserve(preview["messages"][0]["id"], "message")
                return True
            except AppError:
                return False
        finally:
            other.db.close()

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(reserve, range(2))) == [False, True]
    assert len(store.rows("SELECT id FROM outreach_actions")) == 1


async def test_recruiter_preflight_does_not_open_for_ineligible_recipients(store):
    a, c, _, preview, rt, worker = activate(store)
    action = store.outreach.reserve(preview["messages"][0]["id"], "message")
    store.outreach.finish(action, "sent", "Confirmed")
    store.outreach.configure(
        c["id"], preview["rules"] | {"inmail_channel": "recruiter"}
    )
    store.set_service(
        a["id"], "recruiter", {"status": "ready", "contract": "synthetic-contract"}
    )
    with pytest.raises(AppError, match="Выберите получателей"):
        await rt.outreach_preview(c["id"])
    assert worker.actions == []


async def test_bulk_and_settings_api_success_then_identical_save_preserves_preview(
    store,
):
    _, c, first = prepared(store)
    store.add_candidate(c["id"], {"url": "second-person", "name": "Second Person"})
    people = store.detail(c["id"])["candidates"]
    ids = [p["id"] for p in people]
    app = create_app(store, Runtime(store, Worker), "test-token")
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
        headers={"Authorization": "Bearer test-token"},
    ) as client:
        response = await client.post(
            "/command",
            json={
                "op": "candidate.select_many",
                "params": {"campaign_id": c["id"], "ids": ids, "selected": True},
            },
        )
        assert response.json()["result"] == {"saved": True, "changed": 1}
        params = {
            "id": c["id"],
            "rules": DEFAULT_RULES | {"daily_invites": 5},
            "template_open": "New open text",
            "template_neutral": "New neutral text",
        }
        response = await client.post(
            "/command", json={"op": "campaign.save_automation", "params": params}
        )
        assert response.json()["result"]["changed"]
        assert store.campaign(c["id"])["revision"] == c["revision"] + 1
        preview = store.outreach.preview(c["id"])
        response = await client.post(
            "/command", json={"op": "campaign.save_automation", "params": params}
        )
        assert not response.json()["result"]["changed"]
        assert store.outreach.run(preview["run_id"])["status"] == "preview"
        assert {m["message"] for m in preview["messages"]} == {
            "New open text",
            "New neutral text",
        }
        response = await client.post(
            "/command",
            json={
                "op": "candidate.select_many",
                "params": {
                    "campaign_id": c["id"],
                    "ids": [first["id"], "missing"],
                    "selected": False,
                },
            },
        )
        assert response.status_code == 400
        assert store.outreach.run(preview["run_id"])["status"] == "preview"


def test_busy_campaign_rejects_mutations_but_accepts_identical_values(store):
    _, c, person, preview, _, _ = activate(store)
    store.progress(c["id"], "automating", "Processing")
    before = store.detail(c["id"])
    assert store.select_many(c["id"], [person["id"]], True)["changed"] == 0
    assert not store.save_automation(
        c["id"], preview["rules"], c["template_open"], c["template_neutral"]
    )["changed"]
    with pytest.raises(AppError, match="приостановите"):
        store.select_many(c["id"], [person["id"]], False)
    with pytest.raises(AppError, match="приостановите"):
        store.save_automation(c["id"], {}, "Changed", "Changed")
    assert store.detail(c["id"]) == before


def test_settings_write_failure_rolls_back_settings_templates_and_plan(store):
    _, c, _, _, _, _ = activate(store)
    before = store.detail(c["id"])
    store.db.execute(
        "CREATE TEMP TRIGGER reject_settings BEFORE INSERT ON outreach_settings BEGIN SELECT RAISE(ABORT,'synthetic write failure'); END"
    )
    with pytest.raises(sqlite3.IntegrityError):
        store.save_automation(c["id"], {}, "Changed", "Changed")
    assert store.detail(c["id"]) == before


async def test_invitation_confirmed_after_preview_is_carried_into_replacement(store):
    _, c, _, old, rt, worker = activate(store)
    preview = store.outreach.preview(c["id"])
    assert store.outreach.members(preview["run_id"])[0]["invitation_at"] is None
    await rt.outreach.process(old["run_id"])
    invited_at = store.outreach.members(old["run_id"])[0]["invitation_at"]
    store.outreach.approve(preview["run_id"], preview["digest"])
    replacement = store.outreach.members(preview["run_id"])[0]
    assert replacement["invitation_at"] == invited_at
    assert replacement["status"] == "waiting_acceptance"
    worker.observation.update(relationship="pending", can_invite=False)
    await rt.outreach.process(preview["run_id"])
    assert [action for action, _ in worker.actions] == ["invite"]

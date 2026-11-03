"""Real task scheduling with isolated data; no browser process or account access."""

import asyncio

import httpx
import pytest
from booster_recruiter.api import create_app
from booster_recruiter.runtime import Runtime
from booster_recruiter.store import Store
from test_outreach import activate
from test_store import prepared


@pytest.fixture
def store(tmp_path):
    s = Store(tmp_path)
    yield s
    s.db.close()


@pytest.mark.parametrize("operation", ["collect", "check", "outreach", "legacy_send"])
@pytest.mark.parametrize("already_waiting", [False, True])
async def test_queued_pause_completes_before_unrelated_browser_operation(
    store, operation, already_waiting
):
    _, campaign, _, plan, runtime, worker = activate(store)
    calls = []
    original = worker.call

    async def call(action, params=None):
        calls.append(action)
        return await original(action, params)

    worker.call = call
    if operation == "legacy_send":
        batch = store.preview(campaign["id"])
        store.approve(batch["batch_id"], batch["digest"])
        work = runtime.send_batch(batch["batch_id"])
        status = "sending"
    elif operation == "collect":
        work, status = runtime.collect(campaign["id"]), "collecting"
    elif operation == "check":
        work, status = runtime.outreach.check(campaign["id"]), "checking"
    else:
        work, status = runtime.outreach.process(plan["run_id"]), "automating"
    entered, release = asyncio.Event(), asyncio.Event()

    async def unrelated_browser_operation():
        async with runtime.browser_lock:
            entered.set()
            await release.wait()

    holder = asyncio.create_task(unrelated_browser_operation())
    await entered.wait()
    try:
        runtime.start_campaign(campaign["id"], work, status)
        job = runtime.jobs[campaign["id"]]
        if already_waiting:
            await asyncio.sleep(0)
        assert "Ожидаем" in store.campaign(campaign["id"])["progress"]
        response = await asyncio.wait_for(
            runtime.pause_campaign(campaign["id"]), timeout=0.5
        )
        assert response == {"pause_requested": True, "paused": True}
        assert job.done() and job.cancelled()
        assert not holder.done() and runtime.browser_lock.locked()
        assert calls == []
        assert store.campaign(campaign["id"])["status"] == "paused"
        store.ensure_idle(campaign["id"])
        assert store.outreach.run(plan["run_id"])["status"] in {"paused", "cancelled"}
        # A new operation can queue immediately; the cancelled one cannot
        # resurrect when the unrelated browser operation eventually finishes.
        runtime.start_campaign(
            campaign["id"], runtime.collect(campaign["id"]), "collecting"
        )
        await asyncio.sleep(0)
        await runtime.pause_campaign(campaign["id"])
        assert runtime.jobs[campaign["id"]].done() and calls == []
    finally:
        release.set()
        await holder
    assert calls == []


@pytest.mark.parametrize("operation", ["collect", "check", "outreach"])
async def test_active_account_check_pauses_cooperatively_without_cancelling_browser(
    store, operation
):
    _, campaign, _, plan, runtime, worker = activate(store)
    entered, release = asyncio.Event(), asyncio.Event()
    calls = []
    original = worker.call

    async def call(action, params=None):
        calls.append(action)
        if action == "login":
            entered.set()
            await release.wait()
        return await original(action, params)

    worker.call = call
    work, status = {
        "collect": (runtime.collect, "collecting"),
        "check": (runtime.outreach.check, "checking"),
        "outreach": (lambda _: runtime.outreach.process(plan["run_id"]), "automating"),
    }[operation]
    runtime.start_campaign(campaign["id"], work(campaign["id"]), status)
    job = runtime.jobs[campaign["id"]]
    await asyncio.wait_for(entered.wait(), 0.5)
    try:
        response = await runtime.pause_campaign(campaign["id"])
        assert response == {"pause_requested": True, "paused": False}
        assert not job.done() and not job.cancelling()
        assert runtime.browser_lock.locked()
        assert "Приостанавливаем" in store.campaign(campaign["id"])["progress"]
    finally:
        release.set()
        await job
    assert calls == ["login"]
    assert store.campaign(campaign["id"])["status"] == "paused"
    store.ensure_idle(campaign["id"])


@pytest.mark.parametrize("outcome", ["confirmed", "uncertain", "lost_response"])
async def test_pause_during_send_keeps_single_dispatch_and_records_real_outcome(
    store, outcome
):
    _, campaign, _, plan, runtime, worker = activate(store)
    worker.observation.update(
        relationship="connected", can_invite=False, free_message=True
    )
    entered, release = asyncio.Event(), asyncio.Event()
    original = worker.call
    sends = []

    async def call(action, params=None):
        if action == "send_free":
            sends.append(params)
            entered.set()
            await release.wait()
            if outcome == "lost_response":
                raise ConnectionError("Response lost after dispatch")
            if outcome == "uncertain":
                return {"sent": False, "retry_safe": False}
        return await original(action, params)

    worker.call = call
    runtime.start_campaign(
        campaign["id"], runtime.outreach.process(plan["run_id"]), "automating"
    )
    job = runtime.jobs[campaign["id"]]
    await asyncio.wait_for(entered.wait(), 0.5)
    try:
        await runtime.pause_campaign(campaign["id"])
        assert not job.done() and not job.cancelling()
        assert store.rows("SELECT status FROM outreach_actions") == [
            {"status": "submitting"}
        ]
    finally:
        release.set()
        await job
    assert len(sends) == 1
    assert store.rows("SELECT status FROM outreach_actions") == [
        {"status": "sent" if outcome == "confirmed" else "unknown"}
    ]
    assert store.outreach.run(plan["run_id"])["status"] == "paused"
    assert store.campaign(campaign["id"])["status"] == "paused"


async def test_pause_api_releases_queued_collection_while_browser_stays_busy(store):
    _, campaign, _ = prepared(store)
    runtime = Runtime(store)
    await runtime.browser_lock.acquire()
    try:
        app = create_app(store, runtime, "test-token")
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://test",
            headers={"Authorization": "Bearer test-token"},
        ) as client:
            started = await client.post(
                "/command",
                json={"op": "campaign.collect", "params": {"id": campaign["id"]}},
            )
            assert started.status_code == 200
            await asyncio.sleep(0)
            assert "Ожидаем" in store.campaign(campaign["id"])["progress"]
            response = await asyncio.wait_for(
                client.post(
                    "/command",
                    json={"op": "campaign.pause", "params": {"id": campaign["id"]}},
                ),
                timeout=0.5,
            )
            assert response.status_code == 200 and response.json()["result"]["paused"]
            assert runtime.browser_lock.locked()
            assert runtime.jobs[campaign["id"]].done()
            assert not runtime.workers
            store.ensure_idle(campaign["id"])
    finally:
        runtime.browser_lock.release()
        await asyncio.gather(*runtime.jobs.values(), return_exceptions=True)

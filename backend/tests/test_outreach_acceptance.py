"""Application controls exercised with isolated SQLite databases and fake browsers."""

import asyncio

import pytest
from booster_recruiter.runtime import Runtime
from booster_recruiter.store import AppError, Store
from test_outreach import Worker, activate, due
from test_runtime import FakeWorker


@pytest.fixture
def store(tmp_path):
    db = Store(tmp_path)
    yield db
    db.db.close()


def legacy_batch(store, aid, url="legacy-recipient", count=1):
    c = store.create_campaign(
        {
            "name": "Legacy queue",
            "keywords": "Hiring",
            "account_id": aid,
            "template_open": "Hello {first_name}",
            "template_neutral": "Hello {first_name}",
        }
    )
    for i in range(count):
        store.add_candidate(c["id"], {"url": f"{url}-{i}", "name": "Legacy Person"})
    for person in store.detail(c["id"])["candidates"]:
        store.review(person["id"], "neutral", True)
    p = store.preview(c["id"])
    store.approve(p["batch_id"], p["digest"])
    return c, p


@pytest.mark.parametrize("status", ["sent", "unknown", "blocked"])
@pytest.mark.parametrize("duplicate_slot", [False, True])
async def test_legacy_queue_obeys_shared_sender_message_budget(
    store, status, duplicate_slot
):
    a, _, _, plan, _, _ = activate(store, daily_messages=1)
    action = store.outreach.reserve(plan["messages"][0]["id"], "message")
    store.outreach.finish(action, status, "attempt")
    sender = a
    if duplicate_slot:
        sender = store.create_account("Duplicate browser slot")
        store.set_account(sender["id"], "ready", store.account(a["id"])["url"])
    c, batch = legacy_batch(store, sender["id"])
    FakeWorker.sent = []
    FakeWorker.fail_send = False
    FakeWorker.identity = store.account(a["id"])["url"]
    rt = Runtime(store, FakeWorker)
    await rt.send_batch(batch["batch_id"])
    assert FakeWorker.sent == []
    assert store.campaign(c["id"])["status"] == "paused"
    assert "бюджет" in store.campaign(c["id"])["progress"]


async def test_legacy_limit_is_isolated_per_sender(store, monkeypatch):
    a, _, _, plan, _, _ = activate(store, daily_messages=1)
    action = store.outreach.reserve(plan["messages"][0]["id"], "message")
    store.outreach.finish(action, "sent", "attempt")
    other = store.create_account("Other sender")
    store.set_account(other["id"], "ready", "other-sender")
    _, batch = legacy_batch(store, other["id"])
    FakeWorker.sent = []
    FakeWorker.fail_send = False
    FakeWorker.identity = store.account(other["id"])["url"]

    async def no_wait(_):
        pass

    monkeypatch.setattr("booster_recruiter.runtime.asyncio.sleep", no_wait)
    await Runtime(store, FakeWorker).send_batch(batch["batch_id"])
    assert len(FakeWorker.sent) == 1


@pytest.mark.parametrize("sent", [True, False, None])
async def test_legacy_account_restriction_stops_queue_and_sender_plans(
    store, monkeypatch, sent
):
    a, _, _, plan, _, _ = activate(store)
    twin = store.create_account("Duplicate browser slot")
    store.set_account(twin["id"], "ready", store.account(a["id"])["url"])
    independent = store.create_account("Independent sender")
    store.set_account(independent["id"], "ready", "independent-sender")
    c, batch = legacy_batch(store, twin["id"], count=2)
    calls = []

    class RestrictedWorker(FakeWorker):
        identity = store.account(a["id"])["url"]

        async def call(self, action, params=None):
            if action == "send":
                calls.append(params)
                return {
                    "sent": sent,
                    "retry_safe": sent is False,
                    "account_restricted": True,
                    "message": "Restricted",
                }
            return await super().call(action, params)

    async def no_wait(_):
        pass

    monkeypatch.setattr("booster_recruiter.runtime.asyncio.sleep", no_wait)
    rt = Runtime(store, RestrictedWorker)
    await rt.send_batch(batch["batch_id"])
    assert len(calls) == 1
    assert store.account(a["id"])["status"] == "restricted"
    assert store.account(twin["id"])["status"] == "restricted"
    assert store.account(independent["id"])["status"] == "ready"
    assert store.outreach.run(plan["run_id"])["status"] == "paused"
    assert store.campaign(c["id"])["status"] == "paused"
    expected = "sent" if sent else "blocked" if sent is False else "unknown"
    assert store.rows("SELECT status FROM deliveries ORDER BY status") == [
        {"status": value} for value in sorted(["pending", expected])
    ]


@pytest.mark.parametrize("kind", ["invite", "message", "inmail"])
@pytest.mark.parametrize("status", ["sent", "unknown", "blocked", "submitting"])
@pytest.mark.parametrize("same_identity", [True, False])
def test_daily_channel_limits_follow_linkedin_identity(
    store, kind, status, same_identity
):
    a, _, _, p, _, _ = activate(
        store, daily_invites=1, daily_messages=1, daily_inmails=1
    )
    action = store.outreach.reserve(p["messages"][0]["id"], kind)
    if status != "submitting":
        store.outreach.finish(action, status, "attempt")
    twin = store.create_account("Duplicate sender slot")
    store.set_account(
        twin["id"],
        "ready",
        store.account(a["id"])["url"] if same_identity else "different-sender",
    )
    c, _ = legacy_batch(store, twin["id"])
    store.outreach.configure(
        c["id"],
        p["rules"] | {"daily_invites": 10, "daily_messages": 10, "daily_inmails": 10},
    )
    other = store.outreach.preview(c["id"])
    store.outreach.approve(other["run_id"], other["digest"])
    if same_identity:
        with pytest.raises(AppError, match="Достигнут дневной бюджет"):
            store.outreach.reserve(other["messages"][0]["id"], kind)
    else:
        assert store.outreach.reserve(other["messages"][0]["id"], kind)


def test_unbound_account_slots_do_not_share_sender_identity(store):
    a = store.create_account("New sender A")
    b = store.create_account("New sender B")
    assert store.outreach.sender_ids(a["id"]) == [a["id"]]
    assert store.outreach.sender_ids(b["id"]) == [b["id"]]


async def test_outreach_restriction_requires_sender_reconnection_before_more_actions(
    store,
):
    a, _, _, p, rt, worker = activate(store)
    original = worker.call

    async def call(action, params=None):
        result = await original(action, params)
        if action == "invite":
            return {"invited": False, "retry_safe": True, "account_restricted": True}
        return result

    worker.call = call
    await rt.outreach.process(p["run_id"])
    assert store.account(a["id"])["status"] == "restricted"
    assert store.outreach.run(p["run_id"])["status"] == "paused"
    store.outreach.status(p["run_id"], "active")
    due(store, p)
    await rt.outreach.process(p["run_id"])
    assert store.outreach.run(p["run_id"])["status"] == "paused"
    assert len(worker.actions) == 1


async def test_observation_crossing_work_window_never_reserves_or_sends(
    store, monkeypatch
):
    _, _, _, p, rt, worker = activate(store)
    hours_open = True
    original = worker.call

    async def call(action, params=None):
        nonlocal hours_open
        result = await original(action, params)
        if action == "observe":
            hours_open = False
        return result

    worker.call = call
    monkeypatch.setattr(
        "booster_recruiter.outreach_runtime.within_hours", lambda _: hours_open
    )
    await rt.outreach.process(p["run_id"])
    assert worker.actions == []
    assert store.rows("SELECT * FROM outreach_actions") == []
    assert store.outreach.run(p["run_id"])["status"] == "active"


@pytest.mark.parametrize("operation", ["process", "check"])
@pytest.mark.parametrize("waits_for_browser", [True, False])
async def test_queued_pause_releases_campaign_for_edits_and_resume(
    store, operation, waits_for_browser
):
    _, c, _, p, rt, worker = activate(store)
    calls = []
    original = worker.call

    async def call(action, params=None):
        calls.append(action)
        return await original(action, params)

    worker.call = call
    await rt.browser_lock.acquire()
    coro = (
        rt.outreach.process(p["run_id"])
        if operation == "process"
        else rt.outreach.check(c["id"])
    )
    rt.start_campaign(
        c["id"], coro, "automating" if operation == "process" else "checking"
    )
    if waits_for_browser:
        await asyncio.sleep(0)
    rt.pause_flags.add(c["id"])
    store.outreach.status(p["run_id"], "paused")
    rt.browser_lock.release()
    await rt.jobs[c["id"]]
    assert calls == []
    assert store.campaign(c["id"])["status"] == "paused"
    store.ensure_idle(c["id"])
    assert store.outreach.run(p["run_id"])["status"] == "paused"


async def test_pause_during_read_only_observation_keeps_paused_campaign_status(store):
    _, c, _, p, rt, worker = activate(store)
    original = worker.call

    async def call(action, params=None):
        result = await original(action, params)
        if action == "observe":
            rt.pause_flags.add(c["id"])
            store.outreach.status(p["run_id"], "paused")
        return result

    worker.call = call
    await rt.outreach.check(c["id"])
    assert store.campaign(c["id"])["status"] == "paused"
    assert worker.actions == []


@pytest.mark.parametrize("free", [True, False])
async def test_recruiter_inmail_and_reply_keep_approved_context_and_charge(store, free):
    a, c, _, first, _, _ = activate(store)
    store.outreach.configure(c["id"], first["rules"] | {"inmail_channel": "recruiter"})
    context = {
        "contract": "Approved contract",
        "manual_texts": True,
        "signature": "Approved signature",
        "sender_name": "Recruiter",
    }
    store.set_service(a["id"], "recruiter", context | {"status": "ready"})
    p = store.outreach.preview(c["id"], context)
    store.outreach.approve(p["run_id"], p["digest"])
    rt = Runtime(store, Worker)
    worker = rt.worker(a["id"])
    worker.observation.update(can_invite=False, inmail_free=free)
    await rt.outreach.process(p["run_id"])
    action, params = worker.actions[0]
    assert action == "send_inmail"
    assert params["recruiter"] == context
    assert params["message"].endswith("\n\nApproved signature")
    assert params["credit_cost"] == (0 if free else 1)
    assert store.outreach.detail(c["id"])["runs"][0]["credits_reserved"] == (
        0 if free else 1
    )
    calls = []
    original = worker.call

    async def call(action, params=None):
        calls.append((action, params))
        if action == "check_reply":
            return {
                "has_reply": True,
                "reply_text": "Interested",
                "thread_id": "reply-thread",
            }
        return await original(action, params)

    worker.call = call
    due(store, p)
    await rt.outreach.process(p["run_id"])
    assert calls[0][0] == "login"
    assert calls[1][0] == "check_reply"
    assert calls[1][1]["recruiter"] == context
    assert calls[1][1]["message"] == p["messages"][0]["inmail_message"]
    member = store.outreach.members(p["run_id"])[0]
    assert member["status"] == "replied"
    assert member["reply_text"] == "Interested"
    assert member["thread_id"] == "reply-thread"
    assert len(worker.actions) == 1

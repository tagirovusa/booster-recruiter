"""Application controls exercised with isolated SQLite databases and fake browsers."""

import asyncio

import pytest
from booster_recruiter.runtime import Runtime
from booster_recruiter.store import AppError, Store
from legacy_history import legacy_approve, legacy_preview
from test_outreach import Worker, activate, due


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
    p = legacy_preview(store, c["id"])
    legacy_approve(store, p["batch_id"], p["digest"])
    return c, p


@pytest.mark.parametrize("kind", ["invite", "message", "inmail"])
@pytest.mark.parametrize("status", ["sent", "unknown", "blocked", "submitting"])
@pytest.mark.parametrize("same_identity", [True, False])
def test_retired_channel_caps_do_not_block_selected_recipients(
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


def additional_outreach(store, account_id, rules, slug):
    campaign, _ = legacy_batch(store, account_id, url=slug, count=2)
    store.outreach.configure(campaign["id"], rules)
    plan = store.outreach.preview(campaign["id"])
    store.outreach.approve(plan["run_id"], plan["digest"])
    return campaign, plan


@pytest.mark.parametrize("kind", ["invite", "send_free", "send_inmail"])
@pytest.mark.parametrize("confirmed", [True, False, None])
async def test_platform_limit_stops_all_sender_plans_without_losing_result(
    store, kind, confirmed
):
    from booster_recruiter.outreach_runtime import OutreachRuntime

    a, c, _, p, rt, worker = activate(store, strategy="fast")
    twin = store.create_account("Same sender")
    store.set_account(twin["id"], "ready", store.account(a["id"])["url"])
    other_campaign, other = additional_outreach(store, twin["id"], p["rules"], "other")
    independent = store.create_account("Independent sender")
    store.set_account(independent["id"], "ready", "independent-sender")
    _, independent_plan = additional_outreach(
        store, independent["id"], p["rules"], "independent"
    )
    if kind == "invite":
        worker.observation.update(inmail=False)
    elif kind == "send_free":
        worker.observation.update(free_message=True)
    original = worker.call

    async def call(action, params=None):
        result = await original(action, params)
        if action == kind:
            return {
                "invited": confirmed if kind == "invite" else False,
                "sent": confirmed if kind != "invite" else False,
                "retry_safe": confirmed is False,
                "platform_limited": True,
                "message": "LinkedIn сообщил о лимите отправки.",
            }
        return result

    worker.call = call
    await rt.outreach.process(p["run_id"])
    assert store.outreach.run(p["run_id"])["status"] == "paused"
    assert store.outreach.run(other["run_id"])["status"] == "paused"
    assert store.outreach.run(independent_plan["run_id"])["status"] == "active"
    assert store.campaign(other_campaign["id"])["status"] == "paused"
    assert other_campaign["id"] in rt.pause_flags
    assert store.account(a["id"])["status"] == "ready"
    assert store.account(twin["id"])["status"] == "ready"
    expected = "sent" if confirmed else "blocked" if confirmed is False else "unknown"
    assert store.rows("SELECT status FROM outreach_actions") == [{"status": expected}]
    await OutreachRuntime(rt).process(other["run_id"])
    assert len(worker.actions) == 1


async def test_platform_limit_exception_keeps_uncertain_action_and_stops_sender(store):
    from booster_recruiter.platform_limits import LinkedInLimitError

    a, _, _, p, rt, worker = activate(store)
    _, other = additional_outreach(store, a["id"], p["rules"], "other")
    original = worker.call

    async def call(action, params=None):
        result = await original(action, params)
        if action == "invite":
            raise LinkedInLimitError("LinkedIn сообщил о недельном лимите приглашений.")
        return result

    worker.call = call
    await rt.outreach.process(p["run_id"])
    assert store.rows("SELECT status FROM outreach_actions") == [{"status": "unknown"}]
    assert store.outreach.run(other["run_id"])["status"] == "paused"
    rt.outreach.tick()
    assert not rt.jobs


@pytest.mark.parametrize("channel", ["invite", "message", "inmail"])
async def test_all_selected_recipients_are_processed_without_retired_caps(
    store, channel
):
    import json

    a, c, _, p, rt, worker = activate(store, strategy="fast")
    for i in range(12):
        store.add_candidate(c["id"], {"url": f"selected-{i}", "name": f"Person {i}"})
    for person in store.detail(c["id"])["candidates"]:
        store.review(person["id"], "neutral", True)
    p = store.outreach.preview(c["id"])
    store.outreach.approve(p["run_id"], p["digest"])
    # Reproduce a persisted 0.2.9 run, not just a new client request.
    with store.db:
        store.db.execute(
            "UPDATE outreach_runs SET rules=? WHERE id=?",
            (
                json.dumps(
                    p["rules"]
                    | {
                        "daily_invites": 10,
                        "daily_messages": 1,
                        "daily_inmails": 1,
                        "inmail_budget": 1,
                    }
                ),
                p["run_id"],
            ),
        )
    if channel == "invite":
        worker.observation.update(inmail=False)
    elif channel == "message":
        worker.observation.update(free_message=True)
    assert p["maximum_credits"] == 13
    await rt.outreach.process(p["run_id"])
    assert len(worker.actions) == 13
    assert set(a[0] for a in worker.actions) == {
        "invite"
        if channel == "invite"
        else "send_free"
        if channel == "message"
        else "send_inmail"
    }
    assert store.outreach.run(p["run_id"])["status"] == "active"


def test_inmail_opt_in_still_required_without_numeric_budget(store):
    from booster_recruiter.outreach import validate_rules

    assert validate_rules({"allow_inmail": True})["allow_inmail"]
    _, _, _, p, _, _ = activate(store, allow_inmail=False)
    assert p["maximum_credits"] == 0
    with pytest.raises(AppError, match="не был утверждён"):
        store.outreach.reserve(p["messages"][0]["id"], "inmail", credit_cost=1)


def test_retired_quota_migration_preserves_schedule_pause_and_unknown_guard(tmp_path):
    import json

    from booster_recruiter.outreach import RETIRED_QUOTAS

    s = Store(tmp_path)
    _, _, _, p, _, _ = activate(s)
    mid = p["messages"][0]["id"]
    s.outreach.status(p["run_id"], "paused")
    s.outreach.update_member(
        mid,
        status="waiting_budget",
        detail="Достигнут дневной бюджет приложения для этого канала (UTC).",
        next_check="2099-01-01T00:00:00+00:00",
    )
    with s.db:
        s.db.execute(
            "UPDATE outreach_runs SET rules=? WHERE id=?",
            (
                json.dumps(
                    p["rules"]
                    | {
                        "daily_invites": 10,
                        "daily_messages": 20,
                        "daily_inmails": 5,
                        "inmail_budget": 2,
                    }
                ),
                p["run_id"],
            ),
        )
    s.db.close()
    s = Store(tmp_path)
    try:
        m = s.outreach.members(p["run_id"])[0]
        assert m["status"] == "planned"
        assert m["next_check"] == "2099-01-01T00:00:00+00:00"
        assert s.outreach.run(p["run_id"])["status"] == "paused"
        assert not (set(s.outreach.run(p["run_id"])["rules"]) & RETIRED_QUOTAS)
        assert not s.rows("SELECT * FROM outreach_actions")
    finally:
        s.db.close()


async def test_account_restriction_takes_priority_over_send_limit(store):
    a, _, _, p, rt, worker = activate(store)
    twin = store.create_account("Same sender")
    store.set_account(twin["id"], "ready", store.account(a["id"])["url"])
    _, other = additional_outreach(store, twin["id"], p["rules"], "restricted")
    original = worker.call

    async def call(action, params=None):
        result = await original(action, params)
        if action == "invite":
            return result | {"account_restricted": True, "platform_limited": True}
        return result

    worker.call = call
    await rt.outreach.process(p["run_id"])
    assert store.account(a["id"])["status"] == "restricted"
    assert store.account(twin["id"])["status"] == "restricted"
    assert store.outreach.run(other["run_id"])["status"] == "paused"
    assert store.rows("SELECT status FROM outreach_actions") == [{"status": "sent"}]

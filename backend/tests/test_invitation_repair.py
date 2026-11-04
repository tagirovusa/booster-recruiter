import asyncio
from datetime import timedelta

import httpx
import pytest
from booster_recruiter.api import create_app
from booster_recruiter.invitation_repair import covered_invitation_actions
from booster_recruiter.outreach import utc
from booster_recruiter.runtime import Runtime
from booster_recruiter.store import AppError, Store
from test_attention_recovery import uncertain_invite
from test_outreach import Worker


@pytest.fixture
def s(tmp_path):
    store = Store(tmp_path)
    yield store
    store.db.close()


async def proposal(s, result=None):
    a, c, m, old = uncertain_invite(s)

    class Browser(Worker):
        async def call(self, kind, p=None):
            if kind == "invite":
                self.actions.append((kind, p))
                return (
                    result
                    if result is not None
                    else {"invited": True, "retry_safe": False}
                )
            return await super().call(kind, p)

    rt = Runtime(s, Browser)
    identity = "review:" + m["id"]
    rt.attention.start(identity)
    await asyncio.gather(*rt.jobs.values())
    item = next(
        i
        for i in rt.attention.decorate(s.workspace.summary())["items"]
        if i["id"] == identity
    )
    assert item["repair"]
    assert not rt.worker(a["id"]).actions
    return rt, a, c, m, old, identity, item["repair"]


async def test_explicit_repair_uses_frozen_note_same_member_preserves_old_unknown_and_pause(
    s,
):
    rt, a, c, m, old, identity, p = await proposal(s)
    assert (
        p["account_id"] == a["id"]
        and p["url"] == m["url"]
        and p["note"] == m["invitation"]
    )
    assert rt.attention.repairs.start(identity, p["digest"], True) == {"started": True}
    with pytest.raises(AppError):
        rt.attention.repairs.start(identity, p["digest"], True)
    await asyncio.gather(*rt.jobs.values())
    assert rt.worker(a["id"]).actions == [
        ("invite", {"url": m["url"], "note": m["invitation"]})
    ]
    current = s.one("SELECT * FROM outreach_members WHERE id=?", (m["id"],))
    assert current["status"] == "waiting_acceptance"
    assert s.outreach.run(m["run_id"])["status"] == "paused"
    assert (
        s.one("SELECT status FROM outreach_actions WHERE id=?", (old,))["status"]
        == "unknown"
    )
    covered = covered_invitation_actions(s, m["id"])
    assert old in covered
    assert (
        s.outreach.detail(c["id"])["runs"][0]["actions"][-1]["repair_replaced_by"]
        == covered[old]
    )
    # Confirmed replacement covers only historical invites, permitting the next approved message.
    s.outreach.status(m["run_id"], "active")
    s.outreach.reserve(m["id"], "message")
    with pytest.raises(AppError):
        s.outreach.reserve(m["id"], "invite")


@pytest.mark.parametrize("confirm", [None, False, "true"])
async def test_confirmation_required(s, confirm):
    rt, a, c, m, old, identity, p = await proposal(s)
    with pytest.raises(AppError):
        rt.attention.repairs.start(identity, p["digest"], confirm)
    assert not rt.worker(a["id"]).actions


@pytest.mark.parametrize(
    "change", ["expired", "note", "excluded", "cancelled", "sender", "wrong_digest"]
)
async def test_stale_or_changed_proposal_never_dispatches(s, change):
    rt, a, c, m, old, identity, p = await proposal(s)
    if change == "expired":
        rt.attention.repairs.proposals[identity]["public"]["expires_at"] = (
            utc() - timedelta(seconds=1)
        ).isoformat()
    if change == "note":
        with s.db:
            s.db.execute(
                "UPDATE outreach_members SET invitation=? WHERE id=?",
                ("changed", m["id"]),
            )
    if change == "excluded":
        s.suppress(m["url"], "Stop")
    if change == "cancelled":
        s.outreach.status(m["run_id"], "cancelled")
    if change == "sender":
        s.set_account(a["id"], "needs_login")
    with pytest.raises(AppError):
        rt.attention.repairs.start(
            identity, "wrong" if change == "wrong_digest" else p["digest"], True
        )
    assert not rt.worker(a["id"]).actions


@pytest.mark.parametrize("relation", ["connected", "pending"])
async def test_relationship_changed_before_dispatch_settles_without_new_invite(
    s, relation
):
    rt, a, c, m, old, identity, p = await proposal(s)
    rt.worker(a["id"]).observation.update(relationship=relation, can_invite=False)
    rt.attention.repairs.start(identity, p["digest"], True)
    await asyncio.gather(*rt.jobs.values())
    assert not rt.worker(a["id"]).actions
    assert (
        s.one("SELECT status FROM outreach_actions WHERE id=?", (old,))["status"]
        == "satisfied"
    )


async def test_unknown_repair_stays_parked_and_does_not_cover_old_attempt(s):
    rt, a, c, m, old, identity, p = await proposal(
        s, {"invited": False, "retry_safe": False}
    )
    rt.attention.repairs.start(identity, p["digest"], True)
    await asyncio.gather(*rt.jobs.values())
    assert covered_invitation_actions(s, m["id"]) == {}
    assert (
        s.one("SELECT status FROM outreach_members WHERE id=?", (m["id"],))["status"]
        == "needs_review"
    )
    assert s.outreach.run(m["run_id"])["status"] == "paused"


async def test_repair_preserves_active_plan_without_direct_other_dispatch(s):
    rt, a, c, m, old, identity, p = await proposal(s)
    s.outreach.status(m["run_id"], "active")
    # Recheck after activation gives a fresh status-bound token.
    rt.attention.start(identity)
    await asyncio.gather(*rt.jobs.values())
    assert s.outreach.run(m["run_id"])["status"] == "active"
    p = rt.attention.repairs.public(identity)
    rt.attention.repairs.start(identity, p["digest"], True)
    await asyncio.gather(*rt.jobs.values())
    assert len(rt.worker(a["id"]).actions) == 1
    assert s.outreach.run(m["run_id"])["status"] == "active"


async def test_api_confirm_and_token_are_required(s):
    rt, a, c, m, old, identity, p = await proposal(s)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=create_app(s, rt, "test")),
        base_url="http://test",
    ) as client:
        response = await client.post(
            "/command",
            headers={"Authorization": "Bearer test"},
            json={
                "op": "workspace.retry_invitation",
                "params": {"id": identity, "digest": p["digest"]},
            },
        )
        assert response.json()["error"]
    assert not rt.worker(a["id"]).actions


@pytest.mark.parametrize("code", ["auth", "limit", "restricted", "identity"])
async def test_accountwide_exceptions_before_dispatch_pause_sender_plans(s, code):
    from booster_recruiter.platform_limits import (
        LinkedInAccountRestrictedError,
        LinkedInChallengeError,
        LinkedInLimitError,
    )

    rt, a, c, m, old, identity, p = await proposal(s)
    s.outreach.status(m["run_id"], "active")
    rt.attention.start(identity)
    await asyncio.gather(*rt.jobs.values())
    p = rt.attention.repairs.public(identity)
    original = rt.worker(a["id"]).call

    async def fail(kind, params=None):
        if kind == "login":
            if code == "identity":
                return {"url": "https://www.linkedin.com/in/other-sender"}
            raise {
                "auth": LinkedInChallengeError,
                "limit": LinkedInLimitError,
                "restricted": LinkedInAccountRestrictedError,
            }[code]("Account barrier")
        return await original(kind, params)

    rt.worker(a["id"]).call = fail
    rt.attention.repairs.start(identity, p["digest"], True)
    await asyncio.gather(*rt.jobs.values())
    assert s.outreach.run(m["run_id"])["status"] == "paused"
    assert not rt.worker(a["id"]).actions


async def test_unknown_repair_can_be_read_and_explicitly_offered_again(s):
    rt, a, c, m, old, identity, p = await proposal(
        s, {"invited": False, "retry_safe": False}
    )
    rt.attention.repairs.start(identity, p["digest"], True)
    await asyncio.gather(*rt.jobs.values())
    rt.attention.start(identity)
    await asyncio.gather(*rt.jobs.values())
    assert rt.attention.repairs.public(identity)
    assert not rt.attention.states[identity].get("check_error")
    # A later verified connection satisfies latest attempt and covers the older uncertainty.
    rt.worker(a["id"]).observation.update(relationship="connected", can_invite=False)
    rt.attention.start(identity)
    await asyncio.gather(*rt.jobs.values())
    assert covered_invitation_actions(s, m["id"])
    assert (
        s.one("SELECT status FROM outreach_members WHERE id=?", (m["id"],))["status"]
        == "planned"
    )
    s.outreach.status(m["run_id"], "active")
    s.outreach.reserve(m["id"], "message")


async def test_lost_new_attempt_closes_worker_and_preserves_unknown(s):
    rt, a, c, m, old, identity, p = await proposal(s)
    worker = rt.worker(a["id"])
    calls = []
    original = worker.call

    async def call(kind, params=None):
        if kind == "invite":
            raise ConnectionError("response lost")
        return await original(kind, params)

    async def stop():
        calls.append("closed")

    worker.call = call
    worker.stop = stop
    rt.attention.repairs.start(identity, p["digest"], True)
    await asyncio.gather(*rt.jobs.values())
    assert calls == ["closed"] and a["id"] not in rt.workers
    assert (
        len(
            s.rows(
                "SELECT id FROM outreach_actions WHERE member_id=? AND status='unknown'",
                (m["id"],),
            )
        )
        == 2
    )


async def test_stale_proposal_while_waiting_for_browser_cannot_send(s):
    rt, a, c, m, old, identity, p = await proposal(s)
    await rt.browser_lock.acquire()
    rt.attention.repairs.start(identity, p["digest"], True)
    await asyncio.sleep(0)
    s.suppress(m["url"], "User changed mind")
    rt.browser_lock.release()
    await asyncio.gather(*rt.jobs.values())
    assert not rt.worker(a["id"]).actions


async def test_exclusion_during_dispatch_keeps_actual_result_but_never_reactivates_member(
    s,
):
    rt, a, c, m, old, identity, p = await proposal(s)
    worker = rt.worker(a["id"])
    original = worker.call

    async def call(kind, params=None):
        if kind == "invite":
            s.suppress(m["url"], "Stop future contact")
            return {"invited": True}
        return await original(kind, params)

    worker.call = call
    rt.attention.repairs.start(identity, p["digest"], True)
    await asyncio.gather(*rt.jobs.values())
    assert (
        s.one("SELECT status FROM outreach_members WHERE id=?", (m["id"],))["status"]
        == "excluded"
    )
    assert (
        len(
            s.rows(
                "SELECT id FROM outreach_actions WHERE member_id=? AND status='sent'",
                (m["id"],),
            )
        )
        == 1
    )
    assert s.outreach.blocked(m["url"], m["id"])


async def test_inflight_repair_tracks_current_action_and_blocks_plan_edit(s):
    rt, a, c, m, old, identity, p = await proposal(s)
    worker = rt.worker(a["id"])
    original = worker.call

    async def call(kind, params=None):
        if kind == "invite":
            task = asyncio.current_task()
            assert rt.campaign_operations[c["id"]] is task
            assert task in rt.active_campaign_tasks
            with pytest.raises(AppError):
                s.ensure_idle(c["id"])
            return {"invited": True}
        return await original(kind, params)

    worker.call = call
    rt.attention.repairs.start(identity, p["digest"], True)
    await asyncio.gather(*rt.jobs.values())
    assert not rt.campaign_operations and not rt.active_campaign_tasks
    assert rt.attention.states[identity].get("repair_error") == ""
    assert (
        s.one("SELECT status FROM outreach_members WHERE id=?", (m["id"],))["status"]
        == "waiting_acceptance"
    )
    assert (
        len(
            s.rows(
                "SELECT id FROM outreach_actions WHERE member_id=? AND status='sent'",
                (m["id"],),
            )
        )
        == 1
    )


async def test_pause_all_cancels_queued_repair_even_if_plan_was_already_paused(s):
    rt, a, c, m, old, identity, p = await proposal(s)
    assert s.outreach.run(m["run_id"])["status"] == "paused"
    await rt.browser_lock.acquire()
    rt.attention.repairs.start(identity, p["digest"], True)
    await asyncio.sleep(0)
    await rt.pause_campaign(c["id"])
    rt.browser_lock.release()
    await asyncio.gather(*rt.jobs.values())
    assert not rt.worker(a["id"]).actions
    assert s.outreach.run(m["run_id"])["status"] == "paused"


@pytest.mark.parametrize("accountwide", [False, True])
async def test_readonly_recheck_profile_error_isolated_but_account_limit_pauses(
    s, accountwide
):
    from booster_recruiter.platform_limits import LinkedInLimitError

    a, c, m, old = uncertain_invite(s)
    s.outreach.status(m["run_id"], "active")

    class Browser(Worker):
        async def call(self, kind, p=None):
            if kind == "observe":
                if accountwide:
                    raise LinkedInLimitError("LinkedIn limit")
                raise ConnectionError("Profile unavailable")
            return await super().call(kind, p)

    rt = Runtime(s, Browser)
    worker = rt.worker(a["id"])
    rt.attention.start("review:" + m["id"])
    await asyncio.gather(*rt.jobs.values())
    assert s.outreach.run(m["run_id"])["status"] == (
        "paused" if accountwide else "active"
    )
    assert s.campaign(c["id"])["status"] == ("paused" if accountwide else "waiting")

    assert not worker.actions

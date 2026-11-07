from datetime import timedelta

import pytest
from booster_recruiter.outreach import (
    DEFAULT_RULES,
    now,
    route,
    utc,
    validate_rules,
    within_hours,
)
from booster_recruiter.runtime import Runtime
from booster_recruiter.store import AppError, Store
from test_store import prepared


def plan(store, **changes):
    a, c, p = prepared(store)
    rules = (
        DEFAULT_RULES
        | {
            "start_hour": 0,
            "end_hour": 24,
            "allow_inmail": True,
            "subject_open": "Hello {first_name}",
            "subject_neutral": "Opportunity",
            "invitation": "Let's connect, {first_name}.",
        }
        | changes
    )
    store.outreach.configure(c["id"], rules)
    preview = store.outreach.preview(c["id"])
    return a, c, p, preview


@pytest.fixture
def store(tmp_path):
    s = Store(tmp_path)
    yield s
    s.db.close()


class Worker:
    def __init__(self, *args):
        self.observation = {
            "identity_verified": True,
            "relationship": "not_connected",
            "can_invite": True,
            "free_message": False,
            "inmail": True,
            "credits": 4,
        }
        self.actions = []
        self.fail = False
        self.reply = False

    async def call(self, action, p=None):
        if action == "login":
            return {"url": "https://www.linkedin.com/in/recruiter"}
        if action == "observe":
            return self.observation.copy()
        if action == "check_reply":
            return {"has_reply": self.reply}
        self.actions.append((action, p))
        if self.fail:
            raise ConnectionError("lost browser response")
        return {
            "invited": action == "invite",
            "sent": action in ("send_free", "send_inmail"),
            "thread_id": "exact-thread",
        }

    async def stop(self):
        pass


def activate(s, **changes):
    a, c, person, preview = plan(s, **changes)
    s.outreach.approve(preview["run_id"], preview["digest"])
    rt = Runtime(s, Worker)
    return a, c, person, preview, rt, rt.worker(a["id"])


def due(s, preview):
    mid = preview["messages"][0]["id"]
    s.outreach.update_member(mid, next_check=now())
    return mid


async def test_invite_accept_message_and_reply_are_one_durable_sequence(store):
    a, c, person, p, rt, worker = activate(store)
    await rt.outreach.process(p["run_id"])
    assert worker.actions == [
        ("invite", {"url": person["url"], "note": "Let's connect, Alice."})
    ]
    invited = store.outreach.members(p["run_id"])[0]
    assert invited["status"] == "waiting_acceptance"
    # The row must not keep saying "no contact" next to a pending invitation.
    assert invited["relationship"] == "pending"
    worker.observation.update(
        relationship="connected", can_invite=False, free_message=True
    )
    due(store, p)
    await rt.outreach.process(p["run_id"])
    assert worker.actions[-1] == (
        "send_free",
        {"url": person["url"], "message": "Hello Alice, open opportunity."},
    )
    worker.reply = True
    due(store, p)
    await rt.outreach.process(p["run_id"])
    assert store.outreach.members(p["run_id"])[0]["status"] == "replied"
    due(store, p)
    await rt.outreach.process(p["run_id"])
    assert len(worker.actions) == 2


async def test_contact_recheck_recovers_detection_failure_without_sending_or_resuming(
    store,
):
    a, c, person, p, rt, worker = activate(store)
    mid = p["messages"][0]["id"]
    store.outreach.status(p["run_id"], "paused")
    store.outreach.update_member(
        mid,
        status="needs_review",
        detail="Доступный способ связи не удалось подтвердить.",
    )
    await rt.outreach.check(c["id"])
    member = store.outreach.members(p["run_id"])[0]
    assert member["status"] == "planned" and member["observation"]["can_invite"]
    assert store.outreach.run(p["run_id"])["status"] == "paused"
    assert not worker.actions
    assert not store.rows("SELECT * FROM outreach_actions")


@pytest.mark.parametrize(
    "guard",
    [
        "unknown_send",
        "blocked_attempt",
        "suppressed",
        "invalid_identity",
        "existing_message",
        "active",
        "cancelled",
    ],
)
async def test_contact_recheck_preserves_send_and_approval_guards(store, guard):
    a, c, person, p, rt, worker = activate(store)
    mid = p["messages"][0]["id"]
    if guard in {"unknown_send", "blocked_attempt"}:
        action = store.outreach.reserve(mid, "invite")
        store.outreach.finish(
            action, "unknown" if guard == "unknown_send" else "blocked", "test"
        )
    store.outreach.status(
        p["run_id"],
        "active"
        if guard == "active"
        else "cancelled"
        if guard == "cancelled"
        else "paused",
    )
    store.outreach.update_member(
        mid, status="needs_review", detail="Не подтверждён владелец открытого профиля."
    )
    if guard == "suppressed":
        store.db.execute(
            "INSERT INTO suppression(url,reason,created) VALUES(?,?,?)",
            (person["url"], "test", now()),
        )
        store.db.commit()
    if guard == "invalid_identity":
        worker.observation["identity_verified"] = False
    if guard == "existing_message":
        worker.observation["has_outgoing"] = True
    await rt.outreach.check(c["id"])
    assert store.outreach.members(p["run_id"])[0]["status"] == "needs_review"
    assert not worker.actions


async def test_check_now_retains_pending_invite_then_sends_on_acceptance(store):
    _, _, _, p, rt, worker = activate(store)
    rid = p["run_id"]
    await rt.outreach.process(rid)
    worker.observation.update(relationship="pending", can_invite=False)
    store.outreach.check_now(rid)
    await rt.outreach.process(rid)
    assert len(worker.actions) == 1
    assert store.outreach.members(rid)[0]["status"] == "waiting_acceptance"
    worker.observation.update(relationship="connected", free_message=True)
    store.outreach.check_now(rid)
    await rt.outreach.process(rid)
    assert [a[0] for a in worker.actions] == ["invite", "send_free"]
    store.outreach.check_now(rid)
    await rt.outreach.process(rid)
    assert len(worker.actions) == 2


async def test_existing_connection_sends_once_without_an_invitation(store):
    _, _, _, p, rt, worker = activate(store)
    worker.observation.update(
        relationship="connected", can_invite=False, free_message=True
    )
    await rt.outreach.process(p["run_id"])
    assert [a[0] for a in worker.actions] == ["send_free"]
    store.outreach.check_now(p["run_id"])
    await rt.outreach.process(p["run_id"])
    assert [a[0] for a in worker.actions] == ["send_free"]


def test_check_now_cannot_approve_draft_or_resume_paused_plan(store):
    _, _, _, p = plan(store)
    with pytest.raises(AppError):
        store.outreach.check_now(p["run_id"])
    store.outreach.approve(p["run_id"], p["digest"])
    store.outreach.status(p["run_id"], "paused")
    with pytest.raises(AppError):
        store.outreach.check_now(p["run_id"])
    assert store.outreach.run(p["run_id"])["status"] == "paused"


async def test_fast_inmail_records_one_credit_and_acceptance_never_sends_dm(store):
    _, _, person, p, rt, worker = activate(store, strategy="fast")
    await rt.outreach.process(p["run_id"])
    assert worker.actions == [
        (
            "send_inmail",
            {
                "url": person["url"],
                "subject": "Hello Alice",
                "message": "Hello Alice, open opportunity.",
            },
        )
    ]
    worker.observation.update(relationship="connected", free_message=True)
    due(store, p)
    await rt.outreach.process(p["run_id"])
    assert len(worker.actions) == 1
    assert (
        store.outreach.detail(
            p["account"].get(
                "campaign_id", store.outreach.run(p["run_id"])["campaign_id"]
            )
        )["runs"][0]["credits_reserved"]
        == 1
    )


async def test_economy_waits_before_paid_fallback(store):
    _, _, _, p, rt, worker = activate(store)
    worker.observation.update(relationship="pending", can_invite=False)
    await rt.outreach.process(p["run_id"])
    assert worker.actions == []
    mid = due(store, p)
    store.outreach.update_member(
        mid, invitation_at=(utc() - timedelta(days=8)).isoformat()
    )
    await rt.outreach.process(p["run_id"])
    assert worker.actions[0][0] == "send_inmail"


@pytest.mark.parametrize("credits", [0, None, "5", True])
async def test_unknown_or_empty_balance_never_spends_credits(store, credits):
    _, _, _, p, rt, worker = activate(store, strategy="fast")
    worker.observation["credits"] = credits
    worker.observation["can_invite"] = False
    await rt.outreach.process(p["run_id"])
    assert worker.actions == []
    assert store.outreach.members(p["run_id"])[0]["status"] == "waiting_credits"


async def test_lost_response_retains_credit_and_blocks_affected_recipient(store):
    _, _, _, p, rt, worker = activate(store, strategy="fast")
    worker.fail = True
    await rt.outreach.process(p["run_id"])
    assert store.outreach.run(p["run_id"])["status"] == "active"
    assert store.rows("SELECT status FROM outreach_actions") == [{"status": "unknown"}]
    store.outreach.status(p["run_id"], "active")
    due(store, p)
    worker.fail = False
    await rt.outreach.process(p["run_id"])
    assert len(worker.actions) == 1
    with pytest.raises(AppError, match="неизвестным"):
        store.outreach.reserve(p["messages"][0]["id"], "message")


async def test_suppression_after_observation_prevents_browser_action(store):
    _, _, person, p, rt, worker = activate(store)
    original = worker.call

    async def call(action, params=None):
        result = await original(action, params)
        if action == "observe":
            store.suppress(person["url"], "No contact")
        return result

    worker.call = call
    await rt.outreach.process(p["run_id"])
    assert not worker.actions


async def test_pause_during_observation_prevents_write(store):
    _, c, _, p, rt, worker = activate(store)
    original = worker.call

    async def call(action, params=None):
        result = await original(action, params)
        if action == "observe":
            store.outreach.status(p["run_id"], "paused")
        return result

    worker.call = call
    await rt.outreach.process(p["run_id"])
    assert not worker.actions


def test_free_message_is_not_proof_of_connection():
    obs = {
        "identity_verified": True,
        "free_message": True,
        "relationship": "not_connected",
    }
    assert route(DEFAULT_RULES, obs)[0] == "message"
    assert obs["relationship"] == "not_connected"


def test_fast_mode_falls_back_to_invite_only_for_a_confirmed_zero_balance():
    rules = DEFAULT_RULES | {
        "strategy": "fast",
        "allow_inmail": True,
    }
    obs = {
        "identity_verified": True,
        "relationship": "not_connected",
        "can_invite": True,
        "inmail": True,
        "credits": 0,
    }
    assert route(rules, obs)[0] == "invite"
    assert route(rules, obs | {"credits": None})[0] == "inmail"
    assert route(rules, obs | {"relationship": "pending"})[0] == "waiting_acceptance"


@pytest.mark.parametrize(
    "update",
    [{"has_reply": True}, {"has_outgoing": True}, {"identity_verified": False}],
)
def test_existing_history_or_wrong_profile_prevents_first_outreach(update):
    obs = {"identity_verified": True, "free_message": True} | update
    assert route(DEFAULT_RULES, obs)[0] in ("needs_review", "replied")


def test_invite_disappearing_does_not_prove_acceptance():
    obs = {"identity_verified": True, "relationship": "unknown"}
    assert route(DEFAULT_RULES, obs, now())[0] == "waiting_acceptance"


def test_unapproved_plan_cannot_reserve_or_resume(store):
    _, _, _, p = plan(store)
    with pytest.raises(AppError):
        store.outreach.reserve(p["messages"][0]["id"], "inmail")
    with pytest.raises(AppError):
        store.outreach.status(p["run_id"], "active")


def test_rules_and_exact_subject_are_frozen_and_edits_revoke_approval(store):
    _, c, _, p = plan(store)
    assert p["messages"][0]["subject"] == "Hello Alice"
    store.outreach.approve(p["run_id"], p["digest"])
    store.outreach.configure(c["id"], p["rules"] | {"subject_open": "Changed subject"})
    with pytest.raises(AppError):
        store.outreach.reserve(p["messages"][0]["id"], "inmail")
    assert (
        store.outreach.run(p["run_id"])["rules"]["subject_open"] == "Hello {first_name}"
    )


def test_wrong_digest_cannot_approve(store):
    _, _, _, p = plan(store)
    with pytest.raises(AppError, match="устарел"):
        store.outreach.approve(p["run_id"], "wrong")


def test_recruiter_contract_signature_and_source_are_frozen(store):
    a, c, _, _ = plan(store)
    store.outreach.configure(
        c["id"], store.outreach.rules(c["id"]) | {"inmail_channel": "recruiter"}
    )
    context = {
        "contract": "Approved company",
        "manual_texts": True,
        "credits": 42,
        "signature": "Recruiter\nApproved company",
    }
    with pytest.raises(AppError):
        store.outreach.preview(c["id"], context)
    store.set_service(a["id"], "recruiter", context | {"status": "ready"})
    preview = store.outreach.preview(c["id"], context)
    assert preview["messages"][0]["inmail_message"].endswith(
        "\n\nRecruiter\nApproved company"
    )
    assert preview["messages"][0]["message"] == "Hello Alice, open opportunity."
    store.outreach.approve(preview["run_id"], preview["digest"])
    store.set_service(
        a["id"], "recruiter", context | {"status": "ready", "contract": "Other company"}
    )
    assert (
        store.outreach.run(preview["run_id"])["context"]["contract"]
        == "Approved company"
    )
    with pytest.raises(AppError):
        store.outreach.preview(c["id"], context)


def test_free_recruiter_message_counts_as_attempt_but_not_spent_credit(store):
    _, c, _, p, _, _ = activate(store)
    mid = p["messages"][0]["id"]
    action = store.outreach.reserve(mid, "inmail", credit_cost=0)
    store.outreach.finish(action, "sent", "Free to InMail")
    detail = store.outreach.detail(c["id"])["runs"][0]
    assert detail["credits_reserved"] == 0
    assert len(detail["actions"]) == 1
    with pytest.raises(AppError):
        store.outreach.reserve(mid, "inmail", credit_cost=False)


def test_crash_preserves_uncertainty_and_credit_reservation(tmp_path):
    s = Store(tmp_path)
    _, _, _, p, _, _ = activate(s)
    s.outreach.reserve(p["messages"][0]["id"], "inmail")
    s.db.close()
    s = Store(tmp_path)
    try:
        assert s.rows("SELECT status FROM outreach_actions") == [{"status": "unknown"}]
        assert s.outreach.members(p["run_id"])[0]["status"] == "needs_review"
        with pytest.raises(AppError):
            s.outreach.reserve(p["messages"][0]["id"], "invite")
    finally:
        s.db.close()


def test_one_recipient_cannot_be_approved_from_two_accounts(store):
    _, _, _, p = plan(store)
    _, _, _, other = plan(store)
    store.outreach.approve(p["run_id"], p["digest"])
    with pytest.raises(AppError):
        store.outreach.approve(other["run_id"], other["digest"])


def test_credit_history_counts_unknown_results_until_manually_resolved(store):
    _, c, _, p, _, _ = activate(store)
    mid = p["messages"][0]["id"]
    action = store.outreach.reserve(mid, "inmail")
    store.outreach.finish(action, "unknown", "Unknown")
    assert store.outreach.detail(c["id"])["runs"][0]["credits_reserved"] == 1
    store.outreach.resolve(action, False)
    assert store.outreach.detail(c["id"])["runs"][0]["credits_reserved"] == 0


async def test_editing_waiting_campaign_preserves_invitation_without_resending(store):
    _, c, _, p, rt, worker = activate(store)
    await rt.outreach.process(p["run_id"])
    invited_at = store.outreach.members(p["run_id"])[0]["invitation_at"]
    store.templates(c["id"], "New approved text for {first_name}.", "Neutral")
    replacement = store.outreach.preview(c["id"])
    store.outreach.approve(replacement["run_id"], replacement["digest"])
    assert (
        store.outreach.members(replacement["run_id"])[0]["invitation_at"] == invited_at
    )
    worker.observation.update(relationship="pending", can_invite=False)
    await rt.outreach.process(replacement["run_id"])
    assert len(worker.actions) == 1
    due(store, replacement)
    worker.observation.update(relationship="connected", free_message=True)
    await rt.outreach.process(replacement["run_id"])
    assert worker.actions[-1][1]["message"] == "New approved text for Alice."


async def test_readonly_connection_check_never_invites_or_sends(store):
    a, c, person, p = plan(store)
    rt = Runtime(store, Worker)
    await rt.outreach.check(c["id"])
    assert rt.worker(a["id"]).actions == []
    assert (
        store.detail(c["id"])["candidates"][0]["data"]["contact"]["relationship"]
        == "not_connected"
    )


async def test_old_daily_cap_from_paused_campaign_does_not_block_next_campaign(store):
    a, c, person, p, rt, worker = activate(store, daily_invites=1)
    await rt.outreach.process(p["run_id"])
    store.outreach.status(p["run_id"], "paused")
    other = store.create_campaign(
        {
            "name": "Second",
            "keywords": "Recruiter",
            "account_id": a["id"],
            "template_open": "Hello",
            "template_neutral": "Hello",
        }
    )
    store.add_candidate(other["id"], {"url": "another-person", "name": "Another"})
    person2 = store.detail(other["id"])["candidates"][0]
    store.review(person2["id"], "neutral", True)
    store.outreach.configure(other["id"], p["rules"] | {"daily_invites": 10})
    p2 = store.outreach.preview(other["id"])
    store.outreach.approve(p2["run_id"], p2["digest"])
    await rt.outreach.process(p2["run_id"])
    assert len(worker.actions) == 2
    assert store.outreach.members(p2["run_id"])[0]["status"] == "waiting_acceptance"


async def test_scheduler_does_not_start_during_login_or_after_pause(store):
    import asyncio

    _, c, _, p, rt, worker = activate(store)
    store.outreach.status(p["run_id"], "paused")
    rt.outreach.tick()
    assert not rt.jobs
    store.outreach.status(p["run_id"], "active")
    await rt.browser_lock.acquire()
    rt.outreach.tick()
    assert not rt.jobs
    rt.browser_lock.release()
    rt.outreach.tick()
    await rt.jobs[c["id"]]
    assert len(worker.actions) == 1
    await asyncio.sleep(0)


async def test_export_contains_outreach_history_and_formula_is_text(store):
    from io import BytesIO

    from openpyxl import load_workbook

    _, c, _, p, rt, worker = activate(store)
    await rt.outreach.process(p["run_id"])
    workbook = load_workbook(BytesIO(store.export(c["id"], "xlsx")))
    history = workbook["История обращений"]
    assert history["B2"].value == "Приглашение"
    assert history["F2"].value == "Let's connect, Alice."
    assert history["F2"].data_type == "s"


@pytest.mark.parametrize(
    "patch",
    [
        {"timezone": "not/a-zone"},
        {"allow_inmail": "yes"},
        {"monitor_days": True},
        {"start_hour": 20, "end_hour": 8},
        {"wait_days": 0},
    ],
)
def test_invalid_policy_is_rejected(patch):
    with pytest.raises(AppError):
        validate_rules(DEFAULT_RULES | patch)


def test_schedule_uses_campaign_timezone():
    rules = DEFAULT_RULES | {"timezone": "Asia/Tbilisi"}
    at = utc("2026-11-03T05:00:00+00:00")
    assert within_hours(rules, at)
    assert not within_hours(rules, at - timedelta(hours=3))


async def test_outside_schedule_no_browser_calls(store):
    a, c, person, p, rt, worker = activate(store)
    hour = utc().hour
    store.db.execute(
        "UPDATE outreach_runs SET rules=? WHERE id=?",
        (
            __import__("json").dumps(
                p["rules"]
                | {"start_hour": (hour + 1) % 24, "end_hour": ((hour + 1) % 24) + 1}
            ),
            p["run_id"],
        ),
    )
    await rt.outreach.process(p["run_id"])
    assert not worker.actions
    assert store.campaign(c["id"])["status"] == "waiting"


def test_connected_member_can_use_approved_recruiter_fallback():
    observation = {
        "identity_verified": True,
        "relationship": "connected",
        "free_message": False,
        "inmail": True,
        "inmail_free": True,
    }
    assert route(DEFAULT_RULES, observation)[0] == "unavailable"
    assert route(DEFAULT_RULES | {"allow_inmail": True}, observation)[0] == "inmail"
    assert (
        route(
            DEFAULT_RULES | {"allow_inmail": True},
            observation | {"inmail_free": False, "credits": 1},
        )[0]
        == "inmail"
    )

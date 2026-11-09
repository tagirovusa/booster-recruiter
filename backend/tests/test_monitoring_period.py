"""The reply-watching period starts at the first contact, never at preview."""

import json
from datetime import timedelta

import pytest
from booster_recruiter.outreach import DEFAULT_RULES, utc, validate_rules
from booster_recruiter.store import AppError, Store
from test_outreach import activate, due


@pytest.fixture
def store(tmp_path):
    s = Store(tmp_path)
    yield s
    s.db.close()


def age_run(store, run_id, days):
    old = (utc() - timedelta(days=days)).isoformat()
    with store.db:
        store.db.execute("UPDATE outreach_runs SET created=? WHERE id=?", (old, run_id))


async def test_long_pause_does_not_finish_people_nobody_contacted(store):
    a, c, person, p, rt, worker = activate(store)
    # The preview was approved 40 days ago and the plan sat paused since.
    age_run(store, p["run_id"], 40)
    await rt.outreach.process(p["run_id"])
    member = store.outreach.members(p["run_id"])[0]
    assert member["status"] == "waiting_acceptance"
    assert worker.actions[0][0] == "invite"


async def test_late_acceptance_still_gets_the_approved_message(store):
    a, c, person, p, rt, worker = activate(store)
    await rt.outreach.process(p["run_id"])
    assert store.outreach.members(p["run_id"])[0]["status"] == "waiting_acceptance"
    # Accepted 31 days after the preview, 10 days after the invitation.
    age_run(store, p["run_id"], 31)
    mid = p["messages"][0]["id"]
    store.outreach.update_member(
        mid, invitation_at=(utc() - timedelta(days=10)).isoformat()
    )
    worker.observation.update(
        relationship="connected", can_invite=False, free_message=True
    )
    due(store, p)
    await rt.outreach.process(p["run_id"])
    assert worker.actions[-1][0] == "send_free"


async def test_period_ends_counted_from_the_invitation(store):
    a, c, person, p, rt, worker = activate(store)
    await rt.outreach.process(p["run_id"])
    mid = p["messages"][0]["id"]
    store.outreach.update_member(
        mid, invitation_at=(utc() - timedelta(days=31)).isoformat()
    )
    due(store, p)
    await rt.outreach.process(p["run_id"])
    assert store.outreach.members(p["run_id"])[0]["status"] == "finished"


@pytest.mark.parametrize("monitor", [3, 7])
def test_watch_period_must_exceed_the_acceptance_wait(monitor):
    with pytest.raises(AppError, match="Срок наблюдения"):
        validate_rules(DEFAULT_RULES | {"wait_days": 7, "monitor_days": monitor})
    assert validate_rules(DEFAULT_RULES | {"wait_days": 7, "monitor_days": 8})


async def test_plans_saved_with_a_short_period_keep_running(store):
    a, c, person, p, rt, worker = activate(store)
    with store.db:
        store.db.execute(
            "UPDATE outreach_runs SET rules=? WHERE id=?",
            (
                json.dumps(
                    DEFAULT_RULES
                    | {
                        "start_hour": 0,
                        "end_hour": 24,
                        "wait_days": 7,
                        "monitor_days": 5,
                    }
                ),
                p["run_id"],
            ),
        )
    await rt.outreach.process(p["run_id"])
    assert worker.actions and worker.actions[0][0] == "invite"

"""A campaign's status never hides what its outreach plan is doing."""

import pytest
from booster_recruiter.outreach import now
from booster_recruiter.store import Store
from test_outreach import activate


@pytest.fixture
def store(tmp_path):
    s = Store(tmp_path)
    yield s
    s.db.close()


async def test_failed_search_keeps_a_scheduled_campaign_waiting(store):
    a, c, person, p, rt, worker = activate(store)
    original = worker.call

    async def call(action, params=None):
        if action == "search":
            raise TimeoutError("LinkedIn did not answer")
        return await original(action, params)

    worker.call = call
    await rt.collect(c["id"])
    assert store.campaign(c["id"])["status"] == "waiting"
    assert store.outreach.run(p["run_id"])["status"] == "active"


async def test_contact_check_keeps_a_scheduled_campaign_waiting(store):
    a, c, person, p, rt, worker = activate(store)
    await rt.outreach.check(c["id"])
    assert store.campaign(c["id"])["status"] == "waiting"
    assert store.outreach.run(p["run_id"])["status"] == "active"


async def test_user_pause_pauses_campaign_and_plan_together(store):
    a, c, person, p, rt, worker = activate(store)
    await rt.pause_campaign(c["id"])
    await rt.outreach.check(c["id"])
    assert store.campaign(c["id"])["status"] == "paused"
    assert store.outreach.run(p["run_id"])["status"] == "paused"


async def test_pause_request_leaves_an_idle_campaign_unchanged(store):
    a, c, person, p, rt, worker = activate(store)
    store.outreach.status(p["run_id"], "cancelled")
    store.progress(c["id"], "ready", "Профилей сохранено: 1.")
    result = await rt.pause_campaign(c["id"])
    assert result["pause_requested"] is True
    campaign = store.campaign(c["id"])
    assert (campaign["status"], campaign["progress"]) == (
        "ready",
        "Профилей сохранено: 1.",
    )


def test_restart_keeps_a_paused_plan_paused(tmp_path):
    first = Store(tmp_path)
    a, c, person, p, rt, worker = activate(first)
    first.outreach.status(p["run_id"], "paused")
    first.progress(c["id"], "automating", "Проверяем…")
    first.db.close()

    restarted = Store(tmp_path)
    try:
        assert restarted.campaign(c["id"])["status"] == "paused"
    finally:
        restarted.db.close()


def test_restart_restores_waiting_for_an_active_plan(tmp_path):
    first = Store(tmp_path)
    a, c, person, p, rt, worker = activate(first)
    first.progress(c["id"], "automating", now())
    first.db.close()

    restarted = Store(tmp_path)
    try:
        assert restarted.campaign(c["id"])["status"] == "waiting"
    finally:
        restarted.db.close()

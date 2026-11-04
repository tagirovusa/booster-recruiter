"""Profile recovery leaves unrelated approved recipients progressing."""

import pytest
from booster_recruiter.outreach import DEFAULT_RULES, now
from booster_recruiter.platform_limits import LinkedInChallengeError, LinkedInLimitError
from booster_recruiter.runtime import Runtime
from booster_recruiter.store import AppError, Store
from test_store import prepared


@pytest.fixture
def scenario(tmp_path):
    store = Store(tmp_path)
    account, campaign, _ = prepared(store, name="First Person", url="first-person")
    store.add_candidate(
        campaign["id"], {"url": "second-person", "name": "Second Person"}
    )
    for p in store.detail(campaign["id"])["candidates"]:
        store.review(p["id"], "open", True)
    store.outreach.configure(
        campaign["id"], DEFAULT_RULES | {"start_hour": 0, "end_hour": 24}
    )
    preview = store.outreach.preview(campaign["id"])
    store.outreach.approve(preview["run_id"], preview["digest"])
    yield store, account, campaign, preview
    store.db.close()


class Browser:
    mode = "unknown"

    def __init__(self, *args):
        self.calls = []
        self.dispatches = []
        self.resets = 0
        self.logins = 0

    async def stop(self):
        self.resets += 1

    async def call(self, action, params=None):
        self.calls.append((action, params))
        if action == "login":
            self.logins += 1
            if self.mode == "fresh_login_failure" and self.logins > 1:
                raise LinkedInChallengeError("Fresh sender verification requires login")
            if self.mode == "identity" and self.logins > 1:
                return {"url": "https://www.linkedin.com/in/wrong-sender"}
            return {"url": "https://www.linkedin.com/in/recruiter"}
        first = params["url"].endswith("first-person")
        if action == "observe":
            if first and self.mode == "observe":
                raise AppError("This profile did not load")
            return {
                "identity_verified": True,
                "relationship": "not_connected",
                "can_invite": True,
            }
        if action == "invite":
            self.dispatches.append(params["url"])
            if first:
                if self.mode in {"transport", "identity", "fresh_login_failure"}:
                    raise ConnectionError("Response transport lost")
                if self.mode == "challenge":
                    raise LinkedInChallengeError("LinkedIn checkpoint")
                if self.mode == "limit":
                    raise LinkedInLimitError("LinkedIn weekly limit")
                if self.mode == "restriction":
                    return {
                        "invited": False,
                        "retry_safe": True,
                        "account_restricted": True,
                    }
                if self.mode == "blocked":
                    return {
                        "invited": False,
                        "retry_safe": True,
                        "message": "Profile unavailable",
                    }
                return {"invited": False, "message": "No confirmation"}
            return {"invited": True}
        raise AssertionError("Unexpected browser operation " + action)


@pytest.mark.parametrize("mode", ["unknown", "blocked", "transport", "observe"])
async def test_failed_profile_is_parked_and_next_profile_continues(scenario, mode):
    s, a, c, p = scenario
    worker = Browser()
    worker.mode = mode
    rt = Runtime(s, lambda *_: worker)
    await rt.outreach.process(p["run_id"])
    members = {m["name"]: m for m in s.outreach.members(p["run_id"])}
    assert members["First Person"]["status"] == "needs_review"
    assert members["Second Person"]["status"] == "waiting_acceptance"
    assert s.outreach.run(p["run_id"])["status"] == "active"
    assert s.campaign(c["id"])["status"] == "waiting"
    assert worker.resets >= 1 and worker.logins == 2
    assert worker.dispatches.count("https://www.linkedin.com/in/first-person") <= 1
    assert worker.dispatches[-1].endswith("second-person")
    # Another scheduler pass cannot retry the failed profile.
    before = list(worker.dispatches)
    rt.outreach.tick()
    assert worker.dispatches == before
    assert s.outreach.run(p["run_id"])["status"] == "active"


@pytest.mark.parametrize(
    "mode", ["challenge", "limit", "restriction", "identity", "fresh_login_failure"]
)
async def test_account_problem_stops_every_later_profile(scenario, mode):
    s, a, c, p = scenario
    worker = Browser()
    worker.mode = mode
    rt = Runtime(s, lambda *_: worker)
    await rt.outreach.process(p["run_id"])
    assert len(worker.dispatches) == 1
    assert s.outreach.run(p["run_id"])["status"] == "paused"
    assert s.campaign(c["id"])["status"] == "paused"
    assert c["id"] in rt.pause_flags


def test_only_review_members_remain_active_without_new_jobs(scenario):
    s, a, c, p = scenario
    rt = Runtime(s, Browser)
    for member in s.outreach.members(p["run_id"]):
        s.outreach.update_member(member["id"], status="needs_review", next_check=now())
    rt.outreach.tick()
    assert rt.jobs == {}
    assert s.outreach.run(p["run_id"])["status"] == "active"
    assert s.campaign(c["id"])["status"] == "waiting"
    assert "требуют внимания" in s.campaign(c["id"])["progress"]


async def test_manual_pause_while_failed_profile_closes_blocks_next_dispatch(scenario):
    s, a, c, p = scenario
    worker = Browser()
    rt = Runtime(s, lambda *_: worker)

    async def stop_and_pause():
        worker.resets += 1
        rt.pause_flags.add(c["id"])
        s.outreach.status(p["run_id"], "paused", "Paused explicitly")

    worker.stop = stop_and_pause
    await rt.outreach.process(p["run_id"])
    assert len(worker.dispatches) == 1
    assert worker.logins == 1
    assert s.outreach.run(p["run_id"])["status"] == "paused"
    assert s.campaign(c["id"])["status"] == "paused"

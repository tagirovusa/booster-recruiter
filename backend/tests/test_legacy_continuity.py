"""Existing approved message queues isolate one uncertain recipient."""

import asyncio

import httpx
import pytest
from booster_recruiter.api import create_app
from booster_recruiter.platform_limits import LinkedInChallengeError, LinkedInLimitError
from booster_recruiter.runtime import Runtime
from booster_recruiter.store import AppError, Store
from test_store import prepared


@pytest.fixture
def scenario(tmp_path):
    store = Store(tmp_path)
    a, c, _ = prepared(store)
    store.add_candidate(c["id"], {"url": "second-person", "name": "Second Person"})
    for person in store.detail(c["id"])["candidates"]:
        store.review(person["id"], "open", True)
    preview = store.preview(c["id"])
    store.approve(preview["batch_id"], preview["digest"])
    yield store, a, c, preview
    store.db.close()


class Worker:
    def __init__(self, *args):
        self.mode = "unknown"
        self.sent = []
        self.logins = 0
        self.stops = 0

    async def stop(self):
        self.stops += 1

    async def call(self, action, p=None):
        if action == "login":
            self.logins += 1
            if self.mode == "identity" and self.logins > 1:
                return {"url": "https://www.linkedin.com/in/wrong-person"}
            return {"url": "https://www.linkedin.com/in/recruiter"}
        assert action == "send"
        self.sent.append(p)
        if p["url"].endswith("alice-example"):
            if self.mode in {"transport", "identity"}:
                raise ConnectionError("Reply lost")
            if self.mode == "challenge":
                raise LinkedInChallengeError("Checkpoint")
            if self.mode == "limit":
                raise LinkedInLimitError("Limit")
            if self.mode == "restriction":
                return {"sent": False, "retry_safe": True, "account_restricted": True}
            return {
                "sent": False,
                "retry_safe": self.mode == "blocked",
                "message": "Profile-specific failure",
            }
        return {"sent": True, "thread_id": "verified-thread"}


@pytest.mark.parametrize("mode", ["unknown", "transport", "blocked"])
async def test_one_legacy_failure_does_not_stop_other_approved_people(scenario, mode):
    s, a, c, p = scenario
    worker = Worker()
    worker.mode = mode
    rt = Runtime(s, lambda *_: worker)
    await rt.send_batch(p["batch_id"])
    statuses = {
        r["url"]: r["status"] for r in s.rows("SELECT url,status FROM deliveries")
    }
    assert statuses["https://www.linkedin.com/in/alice-example"] == (
        "blocked" if mode == "blocked" else "unknown"
    )
    assert statuses["https://www.linkedin.com/in/second-person"] == "sent"
    assert s.campaign(c["id"])["status"] == "ready"
    assert worker.logins == 2 and worker.stops == 1
    assert len(worker.sent) == 2
    assert worker.sent[1]["message"] == "Hello Second, open opportunity."
    await rt.send_batch(p["batch_id"])
    assert len(worker.sent) == 2


@pytest.mark.parametrize("mode", ["challenge", "limit", "restriction", "identity"])
async def test_legacy_account_problem_still_stops_the_remaining_people(scenario, mode):
    s, a, c, p = scenario
    worker = Worker()
    worker.mode = mode
    rt = Runtime(s, lambda *_: worker)
    await rt.send_batch(p["batch_id"])
    assert len(worker.sent) == 1
    assert s.campaign(c["id"])["status"] == "paused"
    assert (
        s.one("SELECT status FROM deliveries WHERE url LIKE '%second-person'")["status"]
        == "pending"
    )


async def test_explicit_resume_skips_old_unknown_and_sends_only_unrelated_pending(
    scenario,
):
    s, a, c, p = scenario
    first = s.one("SELECT id FROM deliveries WHERE url LIKE '%alice-example'")
    s.finish(first["id"], "unknown", "Old attempt")
    worker = Worker()
    rt = Runtime(s, lambda *_: worker)
    assert rt.jobs == {}  # Existing uncertainty never schedules a resume by itself.
    app = create_app(s, rt, "test")
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        result = (
            await client.post(
                "/command",
                headers={"Authorization": "Bearer test"},
                json={"op": "batch.resume", "params": {"id": p["batch_id"]}},
            )
        ).json()
    assert result["result"] == {"started": True}
    await asyncio.gather(*rt.jobs.values())
    assert [x["url"] for x in worker.sent] == [
        "https://www.linkedin.com/in/second-person"
    ]
    assert (
        s.one("SELECT status FROM deliveries WHERE id=?", (first["id"],))["status"]
        == "unknown"
    )


def test_claim_keeps_sender_binding_and_never_reclaims_unknown(scenario):
    s, a, c, p = scenario
    first = s.claim(p["batch_id"])
    s.finish(first["id"], "unknown", "Uncertain")
    second = s.claim(p["batch_id"])
    assert second["id"] != first["id"]
    s.finish(second["id"], "sent")
    assert s.claim(p["batch_id"]) is None


async def test_legacy_resume_cannot_bypass_invalidated_approval(scenario):
    s, a, c, p = scenario
    s.templates(c["id"], "Changed text", "Changed text")
    worker = Worker()
    rt = Runtime(s, lambda *_: worker)
    app = create_app(s, rt, "test")
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        result = (
            await client.post(
                "/command",
                headers={"Authorization": "Bearer test"},
                json={"op": "batch.resume", "params": {"id": p["batch_id"]}},
            )
        ).json()
    assert "error" in result
    assert rt.jobs == {} and worker.sent == []


def test_claim_cannot_switch_sender_or_use_disconnected_slot(scenario):
    s, a, c, p = scenario
    s.set_account(a["id"], "disconnected")
    with pytest.raises(AppError, match="Подключите аккаунт"):
        s.claim(p["batch_id"])
    s.set_account(a["id"], "ready")
    other = s.create_account("Another sender")
    with s.db:
        s.db.execute(
            "UPDATE campaigns SET account_id=? WHERE id=?", (other["id"], c["id"])
        )
    with pytest.raises(AppError, match="Отправитель очереди"):
        s.claim(p["batch_id"])
    assert not s.rows("SELECT id FROM deliveries WHERE status='sending'")


async def test_repeated_pause_revokes_queued_repairs_even_when_already_paused(scenario):
    s, a, c, p = scenario
    rt = Runtime(s, Worker)
    rt.pause_flags.add(c["id"])
    await rt.pause_campaign(c["id"])
    first = rt.pause_generations[c["id"]]
    await rt.pause_campaign(c["id"])
    assert rt.pause_generations[c["id"]] == first + 1
    rt.pause_sender(a["id"], "Account limit")
    assert rt.pause_generations[c["id"]] == first + 2
    assert c["id"] in rt.pause_flags

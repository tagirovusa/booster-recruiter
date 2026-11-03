import pytest
from booster_recruiter.runtime import Runtime, Worker
from booster_recruiter.store import Store
from test_store import prepared


class FakeWorker:
    sent = []
    fail_send = False
    identity = "https://www.linkedin.com/in/recruiter"

    def __init__(self, *args):
        pass

    async def call(self, action, p=None):
        if action == "login":
            return {"url": self.identity, "name": "Recruiter"}
        if action == "send":
            self.sent.append(p)
            if self.fail_send:
                raise ConnectionError("lost reply after submission")
            return {"sent": True, "retry_safe": False, "thread_id": "thread-1"}
        raise AssertionError(action)

    async def stop(self):
        pass


@pytest.fixture
def scenario(tmp_path):
    FakeWorker.sent = []
    FakeWorker.fail_send = False
    FakeWorker.identity = "https://www.linkedin.com/in/recruiter"
    store = Store(tmp_path)
    account, campaign, person = prepared(store)
    p = store.preview(campaign["id"])
    store.approve(p["batch_id"], p["digest"])
    runtime = Runtime(store, FakeWorker)
    yield store, runtime, p, campaign
    store.db.close()


async def test_account_change_prevents_all_sends(scenario):
    store, runtime, p, c = scenario
    FakeWorker.identity = "https://www.linkedin.com/in/another-user"
    await runtime.send_batch(p["batch_id"])
    assert not FakeWorker.sent
    assert store.campaign(c["id"])["status"] == "paused"
    assert store.account(c["account_id"])["status"] == "identity_mismatch"


async def test_lost_send_reply_is_not_retried(scenario):
    store, runtime, p, c = scenario
    FakeWorker.fail_send = True
    await runtime.send_batch(p["batch_id"])
    assert len(FakeWorker.sent) == 1
    assert store.rows("SELECT status FROM deliveries")[0]["status"] == "unknown"
    await runtime.send_batch(p["batch_id"])
    assert len(FakeWorker.sent) == 1


async def test_only_frozen_exact_text_is_sent(scenario, monkeypatch):
    store, runtime, p, c = scenario

    async def no_wait(_):
        pass

    monkeypatch.setattr("booster_recruiter.runtime.asyncio.sleep", no_wait)
    await runtime.send_batch(p["batch_id"])
    assert FakeWorker.sent == [
        {
            "url": "https://www.linkedin.com/in/alice-example",
            "message": "Hello Alice, open opportunity.",
        }
    ]
    assert store.rows("SELECT status,thread_id FROM deliveries") == [
        {"status": "sent", "thread_id": "thread-1"}
    ]


async def test_pause_before_queued_work_does_not_make_browser_calls(scenario):
    store, runtime, p, c = scenario
    await runtime.browser_lock.acquire()
    runtime.start_campaign(c["id"], runtime.send_batch(p["batch_id"]), "sending")
    runtime.pause_flags.add(c["id"])
    runtime.browser_lock.release()
    await runtime.jobs[c["id"]]
    assert store.campaign(c["id"])["status"] == "paused"
    assert not FakeWorker.sent
    assert not runtime.workers


async def test_collection_resumes_past_an_already_saved_first_page(tmp_path):
    store = Store(tmp_path)
    a, c, _ = prepared(store)

    class SearchWorker(FakeWorker):
        async def call(self, action, p=None):
            if action == "search":
                pages = {
                    1: [{"url": "alice-example"}],
                    2: [{"url": "second-person"}],
                    3: [],
                }
                return {"profiles": pages[p["page"]]}
            if action == "profile":
                return {"url": p["url"], "name": "Second Person"}
            return await super().call(action, p)

    runtime = Runtime(store, SearchWorker)
    await runtime.collect(c["id"])
    assert len(store.detail(c["id"])["candidates"]) == 2
    store.db.close()


def test_accounts_get_distinct_claimed_auth_roots_before_logs(tmp_path):
    from booster_linkedin.profile_claim import require_profile_claim

    a, b = Worker(tmp_path, "account-a"), Worker(tmp_path, "account-b")
    assert require_profile_claim(a.root / "profile") != require_profile_claim(
        b.root / "profile"
    )
    assert a.root.parent == b.root.parent
    assert not (a.root / "worker.log").exists()

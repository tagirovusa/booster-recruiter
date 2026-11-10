import pytest
from booster_recruiter.runtime import Runtime, Worker
from booster_recruiter.store import Store
from legacy_history import legacy_approve, legacy_preview
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
    p = legacy_preview(store, campaign["id"])
    legacy_approve(store, p["batch_id"], p["digest"])
    runtime = Runtime(store, FakeWorker)
    yield store, runtime, p, campaign
    store.db.close()


async def test_unresolved_alias_cannot_mark_an_account_ready(scenario):
    store, runtime, _, c = scenario
    FakeWorker.identity = "https://www.linkedin.com/in/me/"
    await runtime.login(c["account_id"])
    account = store.account(c["account_id"])
    assert account["status"] == "needs_login"
    assert "Аккаунт пока не подтверждён" in account["error"]
    assert account["url"] != FakeWorker.identity


async def test_contact_read_timeout_pauses_with_explanation_and_never_sends(scenario):
    store, _, _, campaign = scenario

    class StalledReader(FakeWorker):
        async def call(self, action, params=None):
            if action == "observe":
                raise TimeoutError()
            return await super().call(action, params)

    runtime = Runtime(store, StalledReader)
    await runtime.outreach.check(campaign["id"])
    state = store.campaign(campaign["id"])
    assert state["status"] == "paused"
    assert "не ответил вовремя" in state["progress"]
    assert not FakeWorker.sent


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
                return {
                    "url": p["url"],
                    "name": "Second Person",
                    "headline": "CDL Recruiter",
                }
            return await super().call(action, p)

    runtime = Runtime(store, SearchWorker)
    await runtime.collect(c["id"])
    assert len(store.detail(c["id"])["candidates"]) == 2
    store.db.close()


async def test_collection_skips_profiles_that_do_not_match_the_query(tmp_path):
    store = Store(tmp_path)
    a, c, _ = prepared(store)
    opened = []

    class SearchWorker(FakeWorker):
        async def call(self, action, p=None):
            if action == "search":
                pages = {
                    1: [
                        {"url": "alice-example"},
                        {"url": "off-topic"},
                        {"url": "hidden-match"},
                    ],
                    2: [],
                }
                return {"profiles": pages[p["page"]]}
            if action == "profile":
                opened.append(p["url"])
                return {
                    "url": p["url"],
                    "name": p["url"],
                    "headline": "Love Always Wins",
                    "sections": {
                        "main_profile": "Love Always Wins\nExplore Premium profiles\nCDL Recruiter"
                    },
                }
            if action == "profile_details":
                if p["url"].endswith("hidden-match"):
                    return {"sections": {"experience": "Senior CDL Recruiting lead"}}
                return {"sections": {"experience": "Florist"}}
            return await super().call(action, p)

    runtime = Runtime(store, SearchWorker)
    await runtime.collect(c["id"])
    urls = {x["url"] for x in store.detail(c["id"])["candidates"]}
    assert urls == {
        "https://www.linkedin.com/in/alice-example",
        "https://www.linkedin.com/in/hidden-match",
    }
    progress = store.campaign(c["id"])["progress"]
    assert "Пропущено несоответствующих запросу: 1" in progress
    assert "LinkedIn больше не находит" in progress
    # A rejected profile is not opened again when the limit is raised.
    opened.clear()
    await runtime.collect(c["id"])
    assert opened == []
    store.db.close()


def test_accounts_get_distinct_claimed_auth_roots_before_logs(tmp_path):
    from booster_linkedin.profile_claim import require_profile_claim

    a, b = Worker(tmp_path, "account-a"), Worker(tmp_path, "account-b")
    assert require_profile_claim(a.root / "profile") != require_profile_claim(
        b.root / "profile"
    )
    assert a.root.parent == b.root.parent
    assert not (a.root / "worker.log").exists()


async def test_manual_profile_review_verifies_sender_before_opening(tmp_path):
    store = Store(tmp_path)
    a, _, _ = prepared(store)
    calls = []

    class OpenWorker(FakeWorker):
        identity = "https://www.linkedin.com/in/recruiter"

        async def call(self, action, p=None):
            calls.append(action)
            if action == "open_profile":
                return {"opened": True, "url": p["url"]}
            return await super().call(action, p)

    runtime = Runtime(store, OpenWorker)
    try:
        result = await runtime.open_profile(a["id"], "alice-example")
        assert result["opened"] is True
        assert calls == ["login", "open_profile"]
        OpenWorker.identity = "https://www.linkedin.com/in/wrong-sender"
        with pytest.raises(Exception, match="изменился"):
            await runtime.open_profile(a["id"], "alice-example")
        assert calls == ["login", "open_profile", "login"]
    finally:
        store.db.close()


async def test_manual_review_does_not_interrupt_active_browser(tmp_path):
    from booster_recruiter.store import AppError

    store = Store(tmp_path)
    a, _, _ = prepared(store)
    runtime = Runtime(store, FakeWorker)
    await runtime.browser_lock.acquire()
    try:
        with pytest.raises(AppError, match="Браузер занят"):
            await runtime.open_profile(a["id"], "alice-example")
        assert not runtime.workers
    finally:
        runtime.browser_lock.release()
        store.db.close()


async def test_exhausted_search_is_remembered_until_the_search_changes(tmp_path):
    """LinkedIn running out of results stops the "continue search" offer."""
    store = Store(tmp_path)
    a, c, _ = prepared(store)

    class EmptySearch(FakeWorker):
        async def call(self, action, p=None):
            if action == "search":
                return {"profiles": []}
            return await super().call(action, p)

    await Runtime(store, EmptySearch).collect(c["id"])
    assert store.campaign(c["id"])["search_exhausted_keywords"] == "CDL recruiter"
    # Renaming keeps it; a new number of profiles deserves a fresh search.
    store.update_campaign(c["id"], {"name": "Renamed"})
    assert store.campaign(c["id"])["search_exhausted_keywords"] == "CDL recruiter"
    store.update_campaign(c["id"], {"max_profiles": 30})
    assert store.campaign(c["id"])["search_exhausted_keywords"] is None

    # A changed query (allowed before anything was collected) clears it too.
    fresh = store.create_campaign(
        {
            "name": "Fresh",
            "account_id": a["id"],
            "keywords": "driver recruiter",
            "max_profiles": 5,
            "template_open": "Hello {first_name}",
            "template_neutral": "Hello",
        }
    )
    await Runtime(store, EmptySearch).collect(fresh["id"])
    assert store.campaign(fresh["id"])["search_exhausted_keywords"] == (
        "driver recruiter"
    )
    store.update_campaign(fresh["id"], {"keywords": "truck driver recruiter"})
    assert store.campaign(fresh["id"])["search_exhausted_keywords"] is None
    store.db.close()


async def test_paused_search_is_not_marked_exhausted(tmp_path):
    store = Store(tmp_path)
    _, c, _ = prepared(store)
    runtime = Runtime(store, FakeWorker)
    runtime.pause_flags.add(c["id"])
    await runtime.collect(c["id"])
    assert store.campaign(c["id"])["search_exhausted_keywords"] is None
    store.db.close()

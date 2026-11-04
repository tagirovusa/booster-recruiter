import asyncio

import httpx
import pytest
from booster_recruiter.api import create_app
from booster_recruiter.runtime import Runtime
from booster_recruiter.store import Store
from test_outreach import Worker, activate


@pytest.fixture
def store(tmp_path):
    s = Store(tmp_path)
    yield s
    s.db.close()


def uncertain_invite(s, status="unknown"):
    a, c, p, preview, _, _ = activate(s)
    member = s.outreach.members(preview["run_id"])[0]
    action = s.outreach.reserve(member["id"], "invite")
    s.outreach.finish(action, status, "You are already connected with this profile.")
    s.outreach.update_member(
        member["id"],
        status="needs_review",
        detail="You are already connected with this profile.",
    )
    s.outreach.status(preview["run_id"], "paused")
    return a, c, member, action


@pytest.mark.parametrize(
    "relation,expected", [("connected", "planned"), ("pending", "waiting_acceptance")]
)
async def test_invite_readonly_recheck_satisfies_contact_and_preserves_pause(
    store, relation, expected
):
    a, c, member, action = uncertain_invite(store)

    class ReadOnly(Worker):
        async def call(self, kind, p=None):
            assert kind in {"login", "observe"}, "Recovery must never dispatch outreach"
            if kind == "observe":
                assert p["relationship_only"] is True
                return {"identity_verified": True, "relationship": relation}
            return {"url": store.account(a["id"])["url"]}

    rt = Runtime(store, ReadOnly)
    identity = "review:" + member["id"]
    rt.pause_flags.add(c["id"])
    assert rt.attention.start(identity) == {"started": True}
    assert (
        rt.attention.decorate(store.workspace.summary())["items"][0]["checking"] is True
    )
    await asyncio.gather(*rt.jobs.values())
    current = store.one("SELECT * FROM outreach_members WHERE id=?", (member["id"],))
    assert current["status"] == expected
    assert (
        store.one("SELECT status FROM outreach_actions WHERE id=?", (action,))["status"]
        == "satisfied"
    )
    assert store.outreach.run(member["run_id"])["status"] == "paused"
    assert c["id"] in rt.pause_flags
    assert not any(i["id"] == identity for i in store.workspace.summary()["items"])


def test_cancelled_known_blocked_failure_is_not_an_outstanding_result(store):
    _, _, member, action = uncertain_invite(store, "blocked")
    store.outreach.status(member["run_id"], "cancelled")
    assert not any(
        i.get("member_id") == member["id"] for i in store.workspace.summary()["items"]
    )
    # Truly uncertain dispatches remain actionable even after plan cancellation.
    store.outreach.finish(action, "unknown", "lost response")
    assert any(
        i.get("member_id") == member["id"] for i in store.workspace.summary()["items"]
    )


async def test_wrong_profile_keeps_unknown_and_never_dispatches(store):
    a, c, member, action = uncertain_invite(store)

    class ReadOnly(Worker):
        async def call(self, kind, p=None):
            assert kind in {"login", "observe"}
            return (
                {"url": store.account(a["id"])["url"]}
                if kind == "login"
                else {"identity_verified": False, "relationship": "connected"}
            )

    rt = Runtime(store, ReadOnly)
    rt.attention.start("review:" + member["id"])
    await asyncio.gather(*rt.jobs.values())
    assert (
        store.one("SELECT status FROM outreach_actions WHERE id=?", (action,))["status"]
        == "unknown"
    )
    assert (
        store.one("SELECT status FROM outreach_members WHERE id=?", (member["id"],))[
            "status"
        ]
        == "needs_review"
    )


@pytest.mark.parametrize("confirmed", [True, False])
async def test_message_recovery_demands_positive_confirmation(store, confirmed):
    a, c, member, action = uncertain_invite(store)
    with store.db:
        store.db.execute(
            "UPDATE outreach_actions SET kind='message' WHERE id=?", (action,)
        )

    class ReadOnly(Worker):
        async def call(self, kind, p=None):
            assert kind in {"login", "verify_delivery"}
            if kind == "login":
                return {"url": store.account(a["id"])["url"]}
            assert p["message"] == member["message"] and p["since"]
            return {
                "confirmed": confirmed,
                "thread_id": "verified-thread",
                "detail": "Insufficient evidence",
            }

    rt = Runtime(store, ReadOnly)
    rt.attention.start("review:" + member["id"])
    await asyncio.gather(*rt.jobs.values())
    assert store.one("SELECT status FROM outreach_actions WHERE id=?", (action,))[
        "status"
    ] == ("sent" if confirmed else "unknown")
    assert store.outreach.run(member["run_id"])["status"] == "paused"


async def test_attention_recheck_endpoint_requires_existing_review(store):
    a, c, member, _ = uncertain_invite(store)
    rt = Runtime(store, Worker)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=create_app(store, rt, "secret")),
        base_url="http://test",
        headers={"Authorization": "Bearer secret"},
    ) as client:
        invalid = await client.post(
            "/command",
            json={"op": "workspace.recheck", "params": {"id": "review:missing"}},
        )
        assert invalid.status_code == 400 and not rt.jobs
        response = await client.post(
            "/command",
            json={
                "op": "workspace.recheck",
                "params": {"id": "review:" + member["id"]},
            },
        )
        assert response.status_code == 200
        await asyncio.gather(*rt.jobs.values())


def test_satisfied_connection_never_counts_as_sent_and_blocks_duplicate_invite(store):
    a, c, member, action = uncertain_invite(store)
    store.outreach.finish(action, "satisfied", "contact exists")
    store.outreach.update_member(
        member["id"], status="planned", relationship="connected"
    )
    store.outreach.status(member["run_id"], "active")
    with pytest.raises(Exception, match="Приглашение уже отправлено"):
        store.outreach.reserve(member["id"], "invite")
    # Satisfying an invitation must not suppress an approved ordinary message.
    assert store.outreach.reserve(member["id"], "message")


def test_restore_preserves_deleted_accounts_and_satisfied_invites(store):
    a, c, member, action = uncertain_invite(store)
    copy = store.workspace.create_backup()
    store.outreach.finish(action, "satisfied", "contact")
    with store.db:
        store.db.execute("UPDATE accounts SET status='deleted' WHERE id=?", (a["id"],))
    store.workspace.restore(copy["id"])
    assert (
        store.one("SELECT status FROM accounts WHERE id=?", (a["id"],))["status"]
        == "deleted"
    )
    assert (
        store.one("SELECT status FROM campaigns WHERE id=?", (c["id"],))["status"]
        == "archived"
    )
    assert store.rows("SELECT 1 FROM suppression WHERE url=?", (member["url"],))
    assert not store.workspace.summary()["items"]


@pytest.mark.parametrize("relation", ["connected", "pending"])
async def test_existing_relationship_returns_satisfied_without_opening_submit(
    store, relation
):
    from booster_recruiter.outreach_browser import BrowserOutreach

    browser = BrowserOutreach.__new__(BrowserOutreach)

    async def observe(*args, **kwargs):
        return {
            "identity_verified": True,
            "relationship": relation,
            "can_invite": False,
        }

    browser.observe = observe
    result = await browser.invite("https://www.linkedin.com/in/person", "Note")
    assert result["contact_satisfied"] is True and result["invited"] is False
    assert result["relationship"] == relation


async def test_future_invite_race_enters_planned_without_false_review(store):
    from test_outreach import Worker, activate

    a, c, _, preview, _, _ = activate(store, allow_inmail=False)

    class ConnectedRace(Worker):
        async def call(self, kind, p=None):
            if kind == "login":
                return {"url": store.account(a["id"])["url"]}
            if kind == "observe":
                return {
                    "identity_verified": True,
                    "history_verified": True,
                    "relationship": "not_connected",
                    "can_invite": True,
                }
            assert kind == "invite"
            return {
                "invited": False,
                "contact_satisfied": True,
                "relationship": "connected",
                "retry_safe": True,
            }

    rt = Runtime(store, ConnectedRace)
    await rt.outreach.process(preview["run_id"])
    member = store.outreach.members(preview["run_id"])[0]
    assert member["status"] == "planned" and member["relationship"] == "connected"
    actions = store.rows(
        "SELECT * FROM outreach_actions WHERE member_id=?", (member["id"],)
    )
    assert len(actions) == 1 and actions[0]["status"] == "satisfied"
    assert not any(i["kind"] == "review" for i in store.workspace.summary()["items"])


async def test_recheck_pauses_active_approval_before_reactivating_review_member(store):
    a, c, member, _ = uncertain_invite(store)
    store.outreach.status(member["run_id"], "active")

    class ReadOnly(Worker):
        async def call(self, kind, p=None):
            assert kind in {"login", "observe"}
            return (
                {"url": store.account(a["id"])["url"]}
                if kind == "login"
                else {"identity_verified": True, "relationship": "connected"}
            )

    rt = Runtime(store, ReadOnly)
    rt.attention.start("review:" + member["id"])
    assert store.outreach.run(member["run_id"])["status"] == "paused"
    await asyncio.gather(*rt.jobs.values())
    before = len(rt.jobs)
    rt.outreach.tick()
    assert len(rt.jobs) == before
    assert store.outreach.run(member["run_id"])["status"] == "paused"


async def test_legacy_recheck_never_uses_preview_time_as_dispatch_evidence(store):
    from test_outreach_acceptance import legacy_batch

    a = store.create_account("Legacy sender")
    store.set_account(a["id"], "ready", "https://www.linkedin.com/in/legacy-sender")
    c, preview = legacy_batch(store, a["id"])
    row = store.one("SELECT * FROM deliveries WHERE batch_id=?", (preview["batch_id"],))
    with store.db:
        store.db.execute(
            "UPDATE deliveries SET status='unknown',created='2026-01-01T00:00:00+00:00',updated='2026-02-01T00:00:00+00:00' WHERE id=?",
            (row["id"],),
        )

    class ReadOnly(Worker):
        async def call(self, kind, p=None):
            assert kind in {"login", "verify_delivery"}
            if kind == "login":
                return {"url": store.account(a["id"])["url"]}
            assert p["since"] == "2026-02-01T00:00:00+00:00"
            return {"confirmed": False, "detail": "No precise post-attempt evidence"}

    rt = Runtime(store, ReadOnly)
    rt.attention.start("delivery:" + row["id"])
    await asyncio.gather(*rt.jobs.values())
    current = store.one("SELECT * FROM deliveries WHERE id=?", (row["id"],))
    assert (
        current["status"] == "unknown"
        and current["updated"] == "2026-02-01T00:00:00+00:00"
    )


async def test_readonly_result_cannot_overwrite_concurrent_manual_resolution(store):
    a, c, member, action = uncertain_invite(store)
    with store.db:
        store.db.execute(
            "UPDATE outreach_actions SET kind='message' WHERE id=?", (action,)
        )

    class ChangedDuringRead(Worker):
        async def call(self, kind, p=None):
            if kind == "login":
                return {"url": store.account(a["id"])["url"]}
            assert kind == "verify_delivery"
            store.outreach.resolve(action, False)
            return {"confirmed": True, "thread_id": "thread"}

    rt = Runtime(store, ChangedDuringRead)
    rt.attention.start("review:" + member["id"])
    await asyncio.gather(*rt.jobs.values())
    assert (
        store.one("SELECT status FROM outreach_actions WHERE id=?", (action,))["status"]
        == "blocked"
    )
    assert rt.attention.states["review:" + member["id"]]["check_error"]


async def test_automatic_confirmation_preserves_concurrent_exclusion(store):
    a, c, member, action = uncertain_invite(store)
    with store.db:
        store.db.execute(
            "UPDATE outreach_actions SET kind='message' WHERE id=?", (action,)
        )

    class ExcludedDuringRead(Worker):
        async def call(self, kind, p=None):
            if kind == "login":
                return {"url": store.account(a["id"])["url"]}
            assert kind == "verify_delivery"
            store.suppress(member["url"], "Do not contact")
            store.outreach.update_member(
                member["id"], status="excluded", detail="Do not contact"
            )
            return {"confirmed": True, "thread_id": "thread"}

    rt = Runtime(store, ExcludedDuringRead)
    rt.attention.start("review:" + member["id"])
    await asyncio.gather(*rt.jobs.values())
    assert (
        store.one("SELECT status FROM outreach_members WHERE id=?", (member["id"],))[
            "status"
        ]
        == "excluded"
    )
    assert (
        store.one("SELECT status FROM outreach_actions WHERE id=?", (action,))["status"]
        == "unknown"
    )
    assert rt.attention.states["review:" + member["id"]]["check_error"]


def test_known_old_inmail_without_proof_does_not_offer_automatic_check(store):
    _, _, member, action = uncertain_invite(store)
    with store.db:
        store.db.execute(
            "UPDATE outreach_actions SET kind='inmail' WHERE id=?", (action,)
        )
        store.db.execute(
            "UPDATE outreach_members SET subject='Subject' WHERE id=?", (member["id"],)
        )
    rt = Runtime(store)
    item = next(
        i
        for i in rt.attention.decorate(store.workspace.summary())["items"]
        if i["id"] == "review:" + member["id"]
    )
    assert item["can_recheck"] is False and item["recheck_unavailable_reason"]
    with pytest.raises(Exception, match="автоматического подтверждения"):
        rt.attention.start(item["id"])
    assert not rt.jobs

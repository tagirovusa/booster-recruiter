import asyncio

import httpx
import pytest
from booster_recruiter.account_removal import deletion_preview, remove_account
from booster_recruiter.api import create_app
from booster_recruiter.runtime import Runtime
from booster_recruiter.store import AppError, Store
from legacy_history import legacy_approve, legacy_claim, legacy_preview
from test_outreach import plan
from test_store import prepared


class QuietWorker:
    def __init__(self):
        self.stopped = False

    async def stop(self, *, graceful=None):
        assert graceful is True
        self.stopped = True


@pytest.fixture
def scenario(tmp_path):
    store = Store(tmp_path)
    a, c, person, preview = plan(store)
    run = store.outreach.approve(preview["run_id"], preview["digest"])
    member = store.outreach.members(run["id"])[0]
    action = store.outreach.reserve(member["id"], "invite")
    store.outreach.finish(action, "unknown", "Unknown invitation")
    store.outreach.update_member(
        member["id"], status="needs_review", detail="Check invitation"
    )
    sibling = store.create_account("Same identity, separate slot")
    store.set_account(sibling["id"], "ready", store.account(a["id"])["url"])
    sc = store.create_campaign(
        {"name": "Other campaign", "keywords": "driver", "account_id": sibling["id"]}
    )
    root = tmp_path / "accounts"
    for aid in (a["id"], sibling["id"]):
        (root / aid / "profile").mkdir(parents=True)
        (root / aid / "profile" / "Cookies").write_text("synthetic session")
    rt = Runtime(store)
    rt.workers = {a["id"]: QuietWorker(), sibling["id"]: QuietWorker()}
    yield store, rt, a, c, person, run, action, sibling, sc
    store.db.close()


async def test_remove_one_slot_preserves_sibling_and_archived_history(scenario):
    s, rt, a, c, person, run, action, sibling, sc = scenario
    removed_worker, other_worker = rt.workers[a["id"]], rt.workers[sibling["id"]]
    preview = deletion_preview(s, a["id"])
    assert (
        preview["campaign_count"]
        == preview["profile_count"]
        == preview["history_count"]
        == 1
    )
    result = await remove_account(s, rt, a["id"])
    assert result["deleted"] and result["session_deleted"]
    assert removed_worker.stopped and not other_worker.stopped
    assert not (s.root / "accounts" / a["id"]).exists()
    assert (s.root / "accounts" / sibling["id"] / "profile" / "Cookies").is_file()
    assert s.account(sibling["id"])["status"] == "ready"
    assert s.campaign(sc["id"])["status"] == "draft"
    state = s.state()
    assert [row["id"] for row in state["accounts"]] == [sibling["id"]]
    assert [row["id"] for row in state["archived_accounts"]] == [a["id"]]
    assert [row["id"] for row in state["archived_campaigns"]] == [c["id"]]
    assert s.outreach.run(run["id"])["status"] == "cancelled"
    assert (
        s.one("SELECT status FROM outreach_actions WHERE id=?", (action,))["status"]
        == "unknown"
    )
    assert s.detail(c["id"])["candidates"][0]["id"] == person["id"]
    assert person["url"] in s.export(c["id"], "csv").decode("utf-8-sig")
    assert s.outreach.blocked(
        person["url"], campaign_id=sc["id"], account_id=sibling["id"]
    )
    assert a["id"] not in s.outreach.sender_ids(sibling["id"])
    assert not any(
        item["account_id"] == a["id"] for item in s.workspace.summary()["items"]
    )


async def test_deleted_account_cannot_be_resurrected_or_used(scenario):
    s, rt, a, c, person, run, action, sibling, sc = scenario
    await remove_account(s, rt, a["id"])
    for operation in (
        lambda: s.account(a["id"]),
        lambda: s.set_account(a["id"], "ready"),
        lambda: s.create_campaign(
            {"name": "New", "keywords": "x", "account_id": a["id"]}
        ),
        lambda: s.ensure_idle(c["id"]),
        lambda: rt.worker(a["id"]),
    ):
        with pytest.raises(AppError, match="удалён"):
            operation()
    with pytest.raises(AppError):
        s.outreach.status(run["id"], "active")
    assert s.account(a["id"], include_deleted=True)["status"] == "deleted"


async def test_busy_account_removal_does_not_stop_or_remove_anything(scenario):
    s, rt, a, *_ = scenario
    task = asyncio.create_task(asyncio.sleep(30))
    rt.jobs["busy"] = task
    try:
        with pytest.raises(AppError, match="Приостановите"):
            await remove_account(s, rt, a["id"])
        assert not rt.workers[a["id"]].stopped
        assert (s.root / "accounts" / a["id"]).exists()
    finally:
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)


async def test_new_job_while_worker_closes_aborts_removal(scenario):
    s, rt, a, *_ = scenario

    class QueuingWorker:
        async def stop(self, **kwargs):
            rt.jobs["queued"] = asyncio.create_task(asyncio.sleep(30))

    rt.workers[a["id"]] = QueuingWorker()
    try:
        with pytest.raises(AppError, match="Началась новая"):
            await remove_account(s, rt, a["id"])
        assert s.account(a["id"])["status"] == "ready"
        assert (s.root / "accounts" / a["id"]).exists()
    finally:
        rt.jobs["queued"].cancel()
        await asyncio.gather(rt.jobs["queued"], return_exceptions=True)


async def test_failed_session_cleanup_keeps_account_and_actionable_retry(
    scenario, monkeypatch
):
    s, rt, a, *_ = scenario
    import booster_recruiter.account_removal as removal

    def fail(*args):
        raise PermissionError("session is locked")

    monkeypatch.setattr(removal.shutil, "rmtree", fail)
    with pytest.raises(AppError, match="Закройте окно LinkedIn"):
        await remove_account(s, rt, a["id"])
    assert s.account(a["id"])["status"] == "needs_login"
    assert s.state()["archived_accounts"] == []


async def test_delete_requires_explicit_confirmation_and_authentication(scenario):
    s, rt, a, c, *_ = scenario
    app = create_app(s, rt, "test")
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        unauth = await client.post(
            "/command",
            json={"op": "account.delete", "params": {"id": a["id"], "confirm": True}},
        )
        assert unauth.status_code == 401
        headers = {"Authorization": "Bearer test"}
        for value in (None, False, "true"):
            result = (
                await client.post(
                    "/command",
                    headers=headers,
                    json={
                        "op": "account.delete",
                        "params": {"id": a["id"], "confirm": value},
                    },
                )
            ).json()
            assert "Подтвердите" in result["error"]
        result = (
            await client.post(
                "/command",
                headers=headers,
                json={
                    "op": "account.delete",
                    "params": {"id": a["id"], "confirm": True},
                },
            )
        ).json()
        assert result["result"]["deleted"]
        for op, params in [
            ("account.login", {"id": a["id"]}),
            ("campaign.collect", {"id": c["id"]}),
        ]:
            denied = (
                await client.post(
                    "/command", headers=headers, json={"op": op, "params": params}
                )
            ).json()
            assert "удалён" in denied["error"]


async def test_legacy_ledger_and_suppression_survive_account_removal(tmp_path):
    s = Store(tmp_path)
    try:
        a, c, p = prepared(s)
        preview = legacy_preview(s, c["id"])
        legacy_approve(s, preview["batch_id"], preview["digest"])
        delivery = legacy_claim(s, preview["batch_id"])
        s.finish(delivery["id"], "sent", "Confirmed")
        s.suppress("https://www.linkedin.com/in/no-contact", "No contact")
        await remove_account(s, Runtime(s), a["id"])
        assert (
            s.one("SELECT status FROM deliveries WHERE id=?", (delivery["id"],))[
                "status"
            ]
            == "sent"
        )
        other = s.create_account("Another sender")
        fresh = s.create_campaign(
            {"name": "Fresh", "keywords": "driver", "account_id": other["id"]}
        )
        assert s.outreach.blocked(
            p["url"], campaign_id=fresh["id"], account_id=other["id"]
        )
        assert s.outreach.blocked("https://www.linkedin.com/in/no-contact")
    finally:
        s.db.close()


async def test_symlinked_slot_cannot_remove_an_outside_directory(tmp_path):
    s = Store(tmp_path / "workspace")
    try:
        account = s.create_account("Target")
        outside = tmp_path / "outside"
        outside.mkdir()
        (outside / "Cookies").write_text("synthetic outside session")
        directory = s.root / "accounts"
        directory.mkdir()
        try:
            (directory / account["id"]).symlink_to(outside, target_is_directory=True)
        except (OSError, NotImplementedError):
            pytest.skip("Directory symlinks unavailable on this OS")
        with pytest.raises(AppError, match="безопасно"):
            await remove_account(s, Runtime(s), account["id"])
        assert (outside / "Cookies").is_file()
        assert s.account(account["id"])["status"] == "new"
    finally:
        s.db.close()


async def test_a_modified_database_id_cannot_escape_the_slot_directory(tmp_path):
    s = Store(tmp_path / "workspace")
    try:
        with s.db:
            s.db.execute(
                "INSERT INTO accounts(id,label,created) VALUES('../outside','Outside','2026-01-01')"
            )
        outside = tmp_path / "outside"
        outside.mkdir()
        (outside / "Cookies").write_text("synthetic outside session")
        with pytest.raises(AppError, match="безопасно"):
            await remove_account(s, Runtime(s), "../outside")
        assert (outside / "Cookies").is_file()
    finally:
        s.db.close()


@pytest.mark.parametrize("backup_before_delete", [True, False])
async def test_restoring_a_backup_cannot_resurrect_a_removed_slot(
    scenario, backup_before_delete
):
    s, rt, a, c, *_ = scenario
    backup = s.workspace.create_backup() if backup_before_delete else None
    await remove_account(s, rt, a["id"])
    if backup is None:
        backup = s.workspace.create_backup()
    s.workspace.restore(backup["id"])
    assert s.account(a["id"], include_deleted=True)["status"] == "deleted"
    assert s.campaign(c["id"])["status"] == "archived"
    assert not (s.root / "accounts" / a["id"]).exists()
    assert not any(account["id"] == a["id"] for account in s.state()["accounts"])
    with pytest.raises(AppError, match="удалён"):
        rt.worker(a["id"])

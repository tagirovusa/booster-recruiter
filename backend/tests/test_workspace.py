import os
import sqlite3

import httpx
import pytest
from booster_recruiter.api import create_app
from booster_recruiter.runtime import Runtime
from booster_recruiter.store import AppError, Store


def seed(root):
    s = Store(root)
    a = s.create_account("Recruiter")
    c = s.create_campaign(
        {
            "account_id": a["id"],
            "name": "Drivers",
            "keywords": "driver recruiter",
            "template_open": "Hello {first_name}",
            "template_neutral": "Hello",
        }
    )
    return s, a, c


def test_template_creates_fresh_draft_without_recipients_or_permission(tmp_path):
    s, a, c = seed(tmp_path)
    s.add_candidate(
        c["id"], {"url": "https://www.linkedin.com/in/example", "name": "Example"}
    )
    s.outreach.configure(
        c["id"], {"allow_inmail": True, "timezone": "America/New_York"}
    )
    t = s.workspace.save_template(c["id"], "US trucking")
    other = s.create_account("Other")
    draft = s.workspace.create_from_template(t["id"], other["id"])
    detail = s.detail(draft["id"])
    assert draft["account_id"] == other["id"]
    assert draft["status"] == "draft"
    assert draft["keywords"] == c["keywords"]
    assert draft["template_open"] == c["template_open"]
    assert detail["outreach"]["rules"]["timezone"] == "America/New_York"
    assert detail["candidates"] == detail["batches"] == detail["outreach"]["runs"] == []
    s.workspace.delete_template(t["id"])
    assert s.workspace.templates() == []
    s.db.close()


def test_daily_backup_is_once_per_day_and_excludes_sessions(tmp_path):
    s, _, _ = seed(tmp_path)
    session = tmp_path / "accounts" / "secret"
    session.mkdir(parents=True)
    (session / "Cookies").write_text("private session")
    s.workspace.daily_backup()
    s.workspace.daily_backup()
    copies = s.workspace.backups()
    assert len(copies) == 1
    assert copies[0]["id"].startswith("daily-")
    assert list((tmp_path / "backups").iterdir()) == [
        tmp_path / "backups" / copies[0]["id"]
    ]
    with sqlite3.connect(tmp_path / "backups" / copies[0]["id"]) as db:
        assert db.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        assert db.execute("SELECT COUNT(*) FROM campaigns").fetchone()[0] == 1
    assert (
        b"private session" not in (tmp_path / "backups" / copies[0]["id"]).read_bytes()
    )
    s.db.close()


def test_restore_resets_identity_and_preserves_current_no_contact_rules(tmp_path):
    s, a, c = seed(tmp_path)
    s.set_account(a["id"], "ready", "https://www.linkedin.com/in/recruiter")
    s.set_service(a["id"], "recruiter", {"status": "ready"})
    backup = s.workspace.create_backup()
    s.create_campaign({"account_id": a["id"], "name": "Later", "keywords": "later"})
    s.suppress("https://www.linkedin.com/in/opted-out", "Opted out")
    s.add_candidate(
        c["id"], {"url": "https://www.linkedin.com/in/contacted", "name": "Contacted"}
    )
    person = s.detail(c["id"])["candidates"][0]
    with s.db:
        s.db.execute(
            "INSERT INTO batches VALUES('b',?,?,?,'approved',?)",
            (c["id"], a["id"], "digest", "2026-01-01"),
        )
        s.db.execute(
            "INSERT INTO deliveries VALUES('d','b',?,?,?,'sent','ok',NULL,?,?)",
            (person["id"], person["url"], "Hi", "2026-01-01", "2026-01-01"),
        )
    result = s.workspace.restore(backup["id"])
    assert result == {"restored": True, "requires_login": True}
    assert len(s.state()["campaigns"]) == 1
    assert s.account(a["id"])["status"] == "needs_login"
    assert s.account(a["id"])["url"] == "https://www.linkedin.com/in/recruiter"
    assert s.account(a["id"])["services"] == {}
    assert s.campaign(c["id"])["status"] == "paused"
    assert {r["url"] for r in s.rows("SELECT url FROM suppression")} == {
        "https://www.linkedin.com/in/contacted",
        "https://www.linkedin.com/in/opted-out",
    }
    assert any(b["id"].startswith("before-restore-") for b in s.workspace.backups())
    s.db.close()


@pytest.mark.parametrize("bad", ["../workspace.sqlite3", "missing.sqlite3", None])
def test_restore_rejects_arbitrary_paths_without_touching_data(tmp_path, bad):
    s, _, c = seed(tmp_path)
    with pytest.raises(AppError):
        s.workspace.restore(bad)
    assert s.campaign(c["id"])["name"] == "Drivers"
    s.db.close()


def test_restore_rejects_corruption_and_schema_changes(tmp_path):
    s, _, c = seed(tmp_path)
    backup = s.workspace.create_backup()
    p = tmp_path / "backups" / backup["id"]
    p.write_bytes(b"not sqlite")
    with pytest.raises(AppError):
        s.workspace.restore(backup["id"])
    backup = s.workspace.create_backup()
    with sqlite3.connect(tmp_path / "backups" / backup["id"]) as db:
        db.execute("CREATE TABLE surprise(data TEXT)")
    with pytest.raises(AppError):
        s.workspace.restore(backup["id"])
    assert s.campaign(c["id"])["status"] == "draft"
    s.db.close()


async def test_backup_restore_requires_confirmation_and_idle_runtime(tmp_path):
    s, _, _ = seed(tmp_path)
    rt = Runtime(s)
    backup = s.workspace.create_backup()
    app = create_app(s, rt, "secret")
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
        headers={"Authorization": "Bearer secret"},
    ) as client:

        async def call(params):
            return await client.post(
                "/command", json={"op": "backup.restore", "params": params}
            )

        assert (await call({"id": backup["id"]})).status_code == 400
        await rt.browser_lock.acquire()
        assert (await call({"id": backup["id"], "confirm": True})).status_code == 400
        rt.browser_lock.release()
        assert (await call({"id": backup["id"], "confirm": True})).json()["result"][
            "requires_login"
        ]
    s.db.close()


def test_summary_finds_login_and_legacy_uncertain_send(tmp_path):
    s, a, c = seed(tmp_path)
    s.add_candidate(
        c["id"], {"url": "https://www.linkedin.com/in/example", "name": "Example"}
    )
    p = s.detail(c["id"])["candidates"][0]
    with s.db:
        s.db.execute(
            "INSERT INTO batches VALUES('b',?,?,?,'approved',?)",
            (c["id"], a["id"], "digest", "2026-01-01"),
        )
        s.db.execute(
            "INSERT INTO deliveries VALUES('d','b',?,?,?,'unknown','Verify',NULL,?,?)",
            (p["id"], p["url"], "Hello", "2026-01-01", "2026-01-01"),
        )
    summary = s.workspace.summary()
    assert summary["counts"] == {"login": 1, "reply": 0, "review": 1}
    item = next(i for i in summary["items"] if i["kind"] == "review")
    assert item["campaign_id"] == c["id"] and item["action_id"] == "d"
    assert item["name"] == "Example"
    s.db.close()


def test_reply_acknowledgement_is_persistent_and_new_reply_returns(tmp_path):
    from test_outreach import plan

    s = Store(tmp_path)
    _, _, _, preview = plan(s)
    run = s.outreach.approve(preview["run_id"], preview["digest"])
    member = s.outreach.detail(run["campaign_id"])["runs"][0]["members"][0]
    s.outreach.update_member(member["id"], status="replied", reply_text="Interested")
    item = next(i for i in s.workspace.summary()["items"] if i["kind"] == "reply")
    assert item["detail"] == "Interested" and item["campaign_id"] == run["campaign_id"]
    s.workspace.acknowledge(item["id"])
    s.db.close()
    s = Store(tmp_path)
    assert s.workspace.summary()["counts"]["reply"] == 0
    s.outreach.update_member(member["id"], reply_text="New answer")
    assert s.workspace.summary()["counts"]["reply"] == 1
    s.db.close()


def test_restore_invalidates_approved_run_and_all_preview_permissions(tmp_path):
    from test_outreach import plan

    s = Store(tmp_path)
    _, c, _, preview = plan(s)
    run = s.outreach.approve(preview["run_id"], preview["digest"])
    backup = s.workspace.create_backup()
    s.workspace.restore(backup["id"])
    assert s.outreach.run(run["id"])["status"] == "cancelled"
    assert s.campaign(c["id"])["status"] == "paused"
    s.db.close()


def test_backup_failure_is_visible_and_does_not_prevent_workspace_access(
    tmp_path, monkeypatch
):
    s, _, c = seed(tmp_path)

    def full():
        raise OSError("disk full")

    monkeypatch.setattr(s.workspace, "daily_backup", full)
    s.workspace.try_daily_backup()
    summary = s.workspace.summary()
    assert summary["backup_error"]
    assert s.campaign(c["id"])["name"] == "Drivers"
    s.db.close()


def test_restore_handles_directory_uri_special_characters(tmp_path):
    s, _, c = seed(
        tmp_path / ("test#and space" if os.name == "nt" else "test#question?and space")
    )
    backup = s.workspace.create_backup()
    s.workspace.restore(backup["id"])
    assert s.campaign(c["id"])["status"] == "paused"
    s.db.close()


async def test_restored_run_cannot_be_resumed_through_api(tmp_path):
    from test_outreach import plan

    s = Store(tmp_path)
    _, _, _, preview = plan(s)
    run = s.outreach.approve(preview["run_id"], preview["digest"])
    backup = s.workspace.create_backup()
    s.workspace.restore(backup["id"])
    rt = Runtime(s)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=create_app(s, rt, "secret")),
        base_url="http://test",
        headers={"Authorization": "Bearer secret"},
    ) as client:
        response = await client.post(
            "/command", json={"op": "outreach.resume", "params": {"id": run["id"]}}
        )
    assert response.status_code == 400
    assert s.outreach.run(run["id"])["status"] == "cancelled"
    assert rt.jobs == {}
    s.db.close()

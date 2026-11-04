"""Local workspace conveniences; never authorizes or performs LinkedIn actions."""

import json
import os
import re
import sqlite3
from contextlib import closing
from datetime import datetime, timezone

from .store import AppError, now, uid


class Workspace:
    def __init__(self, store):
        self.s = store
        self.db = store.db
        self.backup_error = ""
        self.db.executescript("""
        CREATE TABLE IF NOT EXISTS workspace_acknowledgements(id TEXT PRIMARY KEY,updated TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS campaign_templates(id TEXT PRIMARY KEY,name TEXT NOT NULL,data TEXT NOT NULL,created TEXT NOT NULL);
        """)

    def summary(self):
        try:
            backups = self.backups()
        except (OSError, AppError):
            backups = []
            self.backup_error = (
                "Резервные копии недоступны. Проверьте папку данных и свободное место."
            )
        items = []
        for a in self.s.state()["accounts"]:
            if a["status"] != "ready":
                items.append(
                    dict(
                        id="login:" + a["id"],
                        kind="login",
                        account_id=a["id"],
                        campaign_id=None,
                        member_id=None,
                        action_id=None,
                        name=a["label"],
                        detail=a.get("error") or "Подключите аккаунт LinkedIn.",
                        updated=a["created"],
                        url=a.get("url"),
                    )
                )
        for (
            m
        ) in self.s.rows("""SELECT m.*,r.campaign_id,r.account_id,r.status AS run_status
                FROM outreach_members m JOIN outreach_runs r ON r.id=m.run_id
                WHERE m.status IN ('replied','needs_review')"""):
            kind = "reply" if m["status"] == "replied" else "review"
            identity = kind + ":" + m["id"]
            if kind == "reply" and self.s.rows(
                "SELECT id FROM workspace_acknowledgements WHERE id=? AND updated=?",
                (identity, m["updated"]),
            ):
                continue
            actions = self.s.rows(
                "SELECT id FROM outreach_actions WHERE member_id=? AND status IN ('unknown','submitting') ORDER BY created DESC LIMIT 1",
                (m["id"],),
            )
            items.append(
                dict(
                    id=identity,
                    kind=kind,
                    account_id=m["account_id"],
                    campaign_id=m["campaign_id"],
                    member_id=m["id"],
                    action_id=actions[0]["id"] if actions else None,
                    name=m["name"] or m["url"],
                    detail=m["reply_text"]
                    if kind == "reply" and m["reply_text"]
                    else m["detail"],
                    updated=m["updated"],
                    url=m["url"],
                )
            )
        for d in self.s.rows("""SELECT d.*,b.campaign_id,b.account_id,p.data FROM deliveries d
                JOIN batches b ON b.id=d.batch_id JOIN candidates p ON p.id=d.candidate_id WHERE d.status='unknown'"""):
            items.append(
                dict(
                    id="delivery:" + d["id"],
                    kind="review",
                    account_id=d["account_id"],
                    campaign_id=d["campaign_id"],
                    member_id=None,
                    action_id=d["id"],
                    name=json.loads(d["data"]).get("name") or d["url"],
                    detail=d["detail"],
                    updated=d["updated"],
                    url=d["url"],
                )
            )
        items.sort(key=lambda i: i["updated"], reverse=True)
        return {
            "items": items,
            "counts": {
                kind: sum(i["kind"] == kind for i in items)
                for kind in ("reply", "login", "review")
            },
            "templates": self.templates(),
            "backups": backups,
            "backup_error": self.backup_error,
        }

    def acknowledge(self, identity):
        item = next(
            (
                i
                for i in self.summary()["items"]
                if i["id"] == identity and i["kind"] == "reply"
            ),
            None,
        )
        if not item:
            raise AppError("Этот ответ уже отмечен или больше не доступен.")
        with self.db:
            self.db.execute(
                "INSERT OR REPLACE INTO workspace_acknowledgements VALUES(?,?)",
                (identity, item["updated"]),
            )
        return {"saved": True}

    def templates(self):
        return [
            {
                "id": r["id"],
                "name": r["name"],
                "created": r["created"],
                **json.loads(r["data"]),
            }
            for r in self.s.rows(
                "SELECT * FROM campaign_templates ORDER BY created DESC"
            )
        ]

    def save_template(self, cid, name):
        name = str(name).strip()
        if not 1 <= len(name) <= 150:
            raise AppError("Введите название шаблона до 150 символов.")
        campaign = self.s.campaign(cid)
        rules = self.s.outreach.detail(cid)["rules"]
        data = {
            key: campaign[key]
            for key in ("keywords", "max_profiles", "template_open", "template_neutral")
        }
        data["rules"] = rules
        identity = uid()
        with self.db:
            self.db.execute(
                "INSERT INTO campaign_templates VALUES(?,?,?,?)",
                (identity, name, json.dumps(data, ensure_ascii=False), now()),
            )
        return next(t for t in self.templates() if t["id"] == identity)

    def create_from_template(self, identity, aid, name=None):
        row = self.s.one("SELECT * FROM campaign_templates WHERE id=?", (identity,))
        data = json.loads(row["data"])
        with self.s.atomic():
            campaign = self.s.create_campaign(
                data | {"name": name or row["name"], "account_id": aid}
            )
            self.s.outreach.configure(campaign["id"], data["rules"])
        return campaign

    def delete_template(self, identity):
        self.s.one("SELECT id FROM campaign_templates WHERE id=?", (identity,))
        with self.db:
            self.db.execute("DELETE FROM campaign_templates WHERE id=?", (identity,))
        return {"deleted": True}

    def backup_directory(self):
        folder = self.s.root / "backups"
        if folder.is_symlink():
            raise AppError("Папка резервных копий недоступна.")
        folder.mkdir(mode=0o700, exist_ok=True)
        return folder

    def backups(self):
        result = []
        for p in self.backup_directory().glob("*.sqlite3"):
            if not p.is_symlink() and re.fullmatch(
                r"(?:daily|manual|before-restore)-\d{8}-[a-f0-9]{32}\.sqlite3", p.name
            ):
                result.append(
                    {
                        "id": p.name,
                        "created": datetime.fromtimestamp(
                            p.stat().st_mtime, timezone.utc
                        ).isoformat(),
                        "bytes": p.stat().st_size,
                    }
                )
        return sorted(result, key=lambda r: r["created"], reverse=True)

    def create_backup(self, kind="manual"):
        if kind not in {"manual", "daily", "before-restore"}:
            raise AppError("Неизвестный тип резервной копии.")
        folder = self.backup_directory()
        identity = f"{kind}-{datetime.now(timezone.utc):%Y%m%d}-{uid()}.sqlite3"
        temporary = folder / ("." + uid() + ".tmp")
        try:
            fd = os.open(temporary, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
            os.close(fd)
            with closing(sqlite3.connect(temporary)) as target:
                self.db.backup(target)
                target.execute("PRAGMA journal_mode=DELETE")
                if target.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                    raise AppError("Не удалось проверить резервную копию.")
            temporary.replace(folder / identity)
        finally:
            temporary.unlink(missing_ok=True)
        return next(b for b in self.backups() if b["id"] == identity)

    def try_daily_backup(self):
        try:
            self.daily_backup()
            self.backup_error = ""
        except (OSError, sqlite3.Error, AppError):
            self.backup_error = "Не удалось сохранить автоматическую копию. Проверьте свободное место и доступ к папке данных; создайте копию вручную."

    def daily_backup(self):
        today = f"daily-{datetime.now(timezone.utc):%Y%m%d}-"
        if not any(b["id"].startswith(today) for b in self.backups()):
            self.create_backup("daily")
        daily = [b for b in self.backups() if b["id"].startswith("daily-")]
        for old in daily[7:]:
            (self.backup_directory() / old["id"]).unlink()

    def restore(self, identity):
        if not isinstance(identity, str) or identity not in {
            b["id"] for b in self.backups()
        }:
            raise AppError("Выберите существующую резервную копию.")
        path = self.backup_directory() / identity
        # Stage the complete source in memory before touching the live database.
        # Require the current known schema; no triggers, views or arbitrary SQL.
        source = sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True)
        stage = sqlite3.connect(":memory:")
        try:
            if source.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                raise AppError("Резервная копия повреждена.")

            def schema(db):
                return {
                    tuple(row)
                    for row in db.execute(
                        "SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'"
                    )
                }

            if schema(source) != schema(self.db):
                raise AppError("Копия несовместима с этой версией приложения.")
            if source.execute("PRAGMA foreign_key_check").fetchall():
                raise AppError("Связи данных резервной копии повреждены.")
            source.backup(stage)
            # An older snapshot must never erase contact prohibitions or allow
            # re-sending messages/invitations created after that snapshot.
            protected = {
                r["url"]: r["reason"]
                for r in self.s.rows("SELECT url,reason FROM suppression")
            }
            for sql in (
                "SELECT url FROM deliveries WHERE status IN ('sent','sending','unknown','replied','invited')",
                "SELECT url FROM outreach_actions WHERE status IN ('sent','submitting','unknown')",
                "SELECT url FROM outreach_members WHERE invitation_at IS NOT NULL OR sent_at IS NOT NULL",
            ):
                for r in self.s.rows(sql):
                    protected.setdefault(
                        r["url"],
                        "Защита от повторного контакта после восстановления копии.",
                    )
            with stage:
                stage.execute(
                    "UPDATE accounts SET status='needs_login',error='Проверьте вход после восстановления резервной копии.'"
                )
                stage.execute("DELETE FROM account_services")
                stage.execute(
                    "UPDATE campaigns SET status='paused',progress='Восстановлено из копии. Проверьте аккаунт и создайте новый предпросмотр.'"
                )
                stage.execute(
                    "UPDATE batches SET status='cancelled' WHERE status IN ('approved','preview')"
                )
                stage.execute(
                    "UPDATE deliveries SET status='unknown' WHERE status='sending'"
                )
                stage.execute(
                    "UPDATE outreach_runs SET status='cancelled',detail='Восстановлено из копии. Подготовьте новый предпросмотр.' WHERE status IN ('active','paused')"
                )
                stage.execute(
                    "UPDATE outreach_runs SET status='cancelled' WHERE status='preview'"
                )
                stage.execute(
                    "UPDATE outreach_actions SET status='unknown' WHERE status='submitting'"
                )
                stage.execute(
                    "UPDATE outreach_members SET status='needs_review',detail='Проверьте результат после восстановления копии.' WHERE id IN (SELECT member_id FROM outreach_actions WHERE status='unknown')"
                )
                stage.executemany(
                    "INSERT OR IGNORE INTO suppression(url,reason,created) VALUES(?,?,?)",
                    [(url, reason, now()) for url, reason in protected.items()],
                )
            self.create_backup("before-restore")
            stage.backup(self.db)
        except sqlite3.Error as exc:
            raise AppError(
                "Не удалось прочитать резервную копию. Текущие данные сохранены."
            ) from exc
        finally:
            stage.close()
            source.close()
        return {"restored": True, "requires_login": True}

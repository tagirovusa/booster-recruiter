from __future__ import annotations

import json
import re
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from string import Formatter

from booster_linkedin.linkedin.identifiers import (
    normalize_person_identifier,
    person_profile_url,
)

from .user_errors import is_user_text, shown


def now():
    return datetime.now(timezone.utc).isoformat()


def uid():
    return uuid.uuid4().hex


def canonical(url):
    return person_profile_url(normalize_person_identifier(url))


class AppError(Exception):
    pass


def message_for(template, person):
    allowed = {"name", "first_name", "headline", "company"}
    values = {k: str(person.get(k) or "").strip() for k in allowed}
    values["first_name"] = values["name"].split(" ")[0]
    try:
        for _, field, spec, conversion in Formatter().parse(template):
            if field is not None and (field not in allowed or spec or conversion):
                raise AppError(
                    "Неизвестная переменная шаблона. Доступны: {name}, {first_name}, {headline}, {company}."
                )
            if field and not values[field]:
                raise AppError(
                    f"В профиле не заполнено поле {{{field}}}. Измените текст или заполните данные."
                )
        text = template.format_map(values).strip()
    except (ValueError, KeyError) as exc:
        raise AppError("Проверьте фигурные скобки и переменные в шаблоне.") from exc
    if not text or len(text) > 1900:
        raise AppError("Сообщение должно содержать от 1 до 1900 символов.")
    if re.search(r"\[(?:link|ссылка)\]", text, re.I):
        raise AppError("Замените [link] настоящей ссылкой.")
    if any(ord(c) < 32 and c not in "\n\r" for c in text):
        raise AppError("В сообщении есть недопустимые управляющие символы.")
    return text.replace("\r\n", "\n").replace("\r", "\n")


class Store:
    @contextmanager
    def atomic(self):
        """Lock before reading a decision that will reserve or replace work."""
        nested = self.db.in_transaction
        savepoint = "operation_" + uid()
        self.db.execute(f"SAVEPOINT {savepoint}" if nested else "BEGIN IMMEDIATE")
        try:
            yield
        except BaseException:
            if nested:
                self.db.execute(f"ROLLBACK TO {savepoint}")
                self.db.execute(f"RELEASE {savepoint}")
            else:
                self.db.rollback()
            raise
        else:
            if nested:
                self.db.execute(f"RELEASE {savepoint}")
            else:
                self.db.commit()

    def __init__(self, root: Path):
        self.root = root
        root.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.db = sqlite3.connect(root / "workspace.sqlite3")
        self.db.row_factory = sqlite3.Row
        self.db.executescript("""
          PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
          CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY,label TEXT NOT NULL,url TEXT,status TEXT NOT NULL DEFAULT 'new',error TEXT,created TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS account_services(account_id TEXT PRIMARY KEY REFERENCES accounts(id),data TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS campaigns(id TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES accounts(id),name TEXT NOT NULL,keywords TEXT NOT NULL,max_profiles INTEGER NOT NULL,template_open TEXT NOT NULL,template_neutral TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'draft',progress TEXT NOT NULL DEFAULT '',created TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1);
          CREATE TABLE IF NOT EXISTS candidates(id TEXT PRIMARY KEY,campaign_id TEXT NOT NULL REFERENCES campaigns(id),url TEXT NOT NULL,data TEXT NOT NULL,segment TEXT NOT NULL DEFAULT 'review',selected INTEGER NOT NULL DEFAULT 0,excluded INTEGER NOT NULL DEFAULT 0,observed TEXT NOT NULL,UNIQUE(campaign_id,url));
          CREATE TABLE IF NOT EXISTS batches(id TEXT PRIMARY KEY,campaign_id TEXT NOT NULL REFERENCES campaigns(id),account_id TEXT NOT NULL REFERENCES accounts(id),digest TEXT NOT NULL,status TEXT NOT NULL,created TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS deliveries(id TEXT PRIMARY KEY,batch_id TEXT NOT NULL REFERENCES batches(id),candidate_id TEXT NOT NULL REFERENCES candidates(id),url TEXT NOT NULL,message TEXT NOT NULL,status TEXT NOT NULL,detail TEXT,thread_id TEXT,created TEXT NOT NULL,updated TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS suppression(url TEXT PRIMARY KEY,reason TEXT NOT NULL,created TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY,created TEXT NOT NULL,kind TEXT NOT NULL,detail TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS migrations(name TEXT PRIMARY KEY,applied TEXT NOT NULL);
          PRAGMA user_version=1;
        """)
        self._ensure_account_status_time()
        # Recovery never retries an operation which may already have sent.
        with self.db:
            self.db.execute(
                "UPDATE deliveries SET status='unknown',detail='Приложение завершилось во время отправки. Проверьте диалог.',updated=? WHERE status='sending'",
                (now(),),
            )
            self.db.execute(
                "UPDATE campaigns SET status='paused',progress='Работа приостановлена после перезапуска.' WHERE status IN ('collecting','sending')"
            )
            # The legacy batch sender is retired. Unsent recipients of an old
            # queue return to the normal flow; sent history keeps protecting
            # people from a second message.
            self.db.execute(
                "UPDATE deliveries SET status='cancelled',detail='Старая очередь закрыта при обновлении приложения. Отправьте через вкладку «Отправка».',updated=? "
                "WHERE status='pending' AND batch_id IN (SELECT id FROM batches WHERE status IN ('approved','preview'))",
                (now(),),
            )
            self.db.execute(
                "UPDATE batches SET status='cancelled' WHERE status IN ('approved','preview')"
            )
            self.db.execute(
                "UPDATE accounts SET status='needs_login' WHERE status='connecting'"
            )
        self._migrate_neutral_default()
        from .outreach import OutreachStore

        self.outreach = OutreachStore(self)
        from .workspace import Workspace

        self.workspace = Workspace(self)

    def _ensure_account_status_time(self):
        """Remember when each account last changed status, so a sign-in request
        shows when it actually appeared rather than when the account was added."""
        columns = {r["name"] for r in self.rows("PRAGMA table_info(accounts)")}
        if "status_changed" in columns:
            return
        with self.db:
            self.db.execute("ALTER TABLE accounts ADD COLUMN status_changed TEXT")
            self.db.execute("UPDATE accounts SET status_changed=created")

    def _migrate_neutral_default(self):
        """Move only old automatic review assignments; keep manual decisions."""
        migration = "0.1.3-neutral-default"
        with self.db:
            if self.rows("SELECT name FROM migrations WHERE name=?", (migration,)):
                return
            affected = set()
            for person in self.rows("SELECT * FROM candidates WHERE segment='review'"):
                data = json.loads(person["data"])
                if data.get("manual_review"):
                    continue
                if (data.get("photo_frame") or {}).get("status") == "open_to_work":
                    continue
                self.db.execute(
                    "UPDATE candidates SET segment='neutral' WHERE id=?",
                    (person["id"],),
                )
                affected.add(person["campaign_id"])
            for cid in affected:
                self.invalidate(cid)
                self.db.execute(
                    "UPDATE campaigns SET revision=revision+1 WHERE id=?", (cid,)
                )
            self.db.execute(
                "INSERT INTO migrations(name,applied) VALUES(?,?)", (migration, now())
            )

    def rows(self, sql, params=()):
        return [dict(r) for r in self.db.execute(sql, params)]

    def one(self, sql, params=()):
        rows = self.rows(sql, params)
        if not rows:
            raise AppError("Запись не найдена.")
        return rows[0]

    def account(self, aid, *, include_deleted=False):
        account = self.one("SELECT * FROM accounts WHERE id=?", (aid,))
        if account["status"] == "deleted" and not include_deleted:
            raise AppError("Этот аккаунт удалён. История сохранена в архиве.")
        services = self.rows(
            "SELECT data FROM account_services WHERE account_id=?", (aid,)
        )
        account["services"] = json.loads(services[0]["data"]) if services else {}
        account["error"] = shown(account.get("error"))
        return account

    def set_service(self, aid, name, value):
        services = self.account(aid)["services"] | {name: value | {"checked_at": now()}}
        with self.db:
            self.db.execute(
                "INSERT INTO account_services(account_id,data) VALUES(?,?) ON CONFLICT(account_id) DO UPDATE SET data=excluded.data",
                (aid, json.dumps(services, ensure_ascii=False)),
            )
        return self.account(aid)

    def campaign(self, cid):
        return self.one("SELECT * FROM campaigns WHERE id=?", (cid,))

    def event(self, kind, detail):
        with self.db:
            self.db.execute(
                "INSERT INTO events(created,kind,detail) VALUES(?,?,?)",
                (now(), kind, detail),
            )

    def create_account(self, label):
        label = str(label).strip()[:100]
        if not label:
            raise AppError("Укажите название аккаунта.")
        aid = uid()
        with self.db:
            self.db.execute(
                "INSERT INTO accounts(id,label,created) VALUES(?,?,?)",
                (aid, label, now()),
            )
        return self.account(aid)

    def set_account(self, aid, status, url=None, error=None, name=None):
        old = self.account(aid)
        if url and old["url"] and canonical(url) != old["url"]:
            status, error, url = (
                "identity_mismatch",
                "Выполнен вход в другой LinkedIn-профиль. Добавьте его отдельным аккаунтом.",
                old["url"],
            )
        with self.db:
            self.db.execute(
                "UPDATE accounts SET status=?,url=COALESCE(?,url),error=?,label=COALESCE(?,label),"
                "status_changed=CASE WHEN status=? THEN status_changed ELSE ? END WHERE id=?",
                (
                    status,
                    canonical(url) if url else None,
                    error,
                    name if status == "ready" else None,
                    status,
                    now(),
                    aid,
                ),
            )
        return self.account(aid)

    def create_campaign(self, data):
        self.account(data["account_id"])
        name = str(data.get("name", "")).strip()
        keywords = str(data.get("keywords", "")).strip()
        limit = int(data.get("max_profiles", 20))
        if (
            not name
            or not keywords
            or len(name) > 150
            or len(keywords) > 1000
            or not 1 <= limit <= 100
        ):
            raise AppError(
                "Укажите название, ключевые слова и объём от 1 до 100 профилей."
            )
        cid = uid()
        with self.db:
            self.db.execute(
                "INSERT INTO campaigns(id,account_id,name,keywords,max_profiles,template_open,template_neutral,created) VALUES(?,?,?,?,?,?,?,?)",
                (
                    cid,
                    data["account_id"],
                    name,
                    keywords,
                    limit,
                    str(data.get("template_open", "")),
                    str(data.get("template_neutral", "")),
                    now(),
                ),
            )
        timezone_name = str(data.get("timezone") or "").strip()
        if timezone_name and hasattr(self, "outreach"):
            # Work in the recruiter's own hours from the start; an unknown
            # zone keeps the safe default instead of failing the creation.
            try:
                self.outreach.configure(cid, {"timezone": timezone_name})
            except AppError:
                pass
        return self.campaign(cid)

    def state(self):
        accounts = [
            self.account(a["id"], include_deleted=True)
            for a in self.rows("SELECT id FROM accounts ORDER BY created DESC")
        ]
        campaigns = self.rows(
            "SELECT c.*,(SELECT COUNT(*) FROM candidates p WHERE p.campaign_id=c.id) AS count FROM campaigns c ORDER BY created DESC"
        )
        for c in campaigns:
            c["progress"] = shown(c.get("progress"))
        events = self.rows("SELECT * FROM events ORDER BY id DESC LIMIT 30")
        for e in events:
            prefix, sep, rest = (e["detail"] or "").partition(": ")
            if sep and len(prefix) == 32 and not is_user_text(rest):
                e["detail"] = f"{prefix}: {shown(rest)}"
            elif not sep or len(prefix) != 32:
                e["detail"] = shown(
                    e["detail"], "Служебная запись; подробности сохранены в журнале."
                )
        deleted = {a["id"] for a in accounts if a["status"] == "deleted"}
        return {
            "accounts": [a for a in accounts if a["id"] not in deleted],
            "archived_accounts": [a for a in accounts if a["id"] in deleted],
            "campaigns": [
                c
                for c in campaigns
                if c["account_id"] not in deleted and c["status"] != "archived"
            ],
            "archived_campaigns": [
                c
                for c in campaigns
                if c["account_id"] in deleted or c["status"] == "archived"
            ],
            "events": events,
        }

    def detail(self, cid):
        campaign = dict(self.campaign(cid))
        campaign["progress"] = shown(campaign.get("progress"))
        people = self.rows(
            "SELECT * FROM candidates WHERE campaign_id=? ORDER BY observed,id", (cid,)
        )
        for person in people:
            person["data"] = json.loads(person["data"])
            person["delivery"] = self.rows(
                "SELECT id,batch_id,status,detail,message,updated,thread_id FROM deliveries WHERE candidate_id=? ORDER BY created DESC LIMIT 1",
                (person["id"],),
            )
            person["blocked"] = bool(
                self.rows("SELECT url FROM suppression WHERE url=?", (person["url"],))
            )
            person["outreach_exclusion"] = self.outreach.exclusion(person, campaign)
            person["outreach_eligible"] = not person["outreach_exclusion"]
            person["outreach_member"] = self.outreach.latest_member(
                person["id"], cid, campaign["account_id"]
            )
        return {
            "campaign": campaign,
            "outreach": self.outreach.detail(cid),
            "candidates": people,
            "batches": self.rows(
                "SELECT b.*,(SELECT COUNT(*) FROM deliveries d WHERE d.batch_id=b.id AND d.status='pending') AS pending,(SELECT COUNT(*) FROM deliveries d WHERE d.batch_id=b.id AND d.status='unknown') AS unknown FROM batches b WHERE campaign_id=? ORDER BY created DESC",
                (cid,),
            ),
        }

    def progress(self, cid, status, text):
        with self.db:
            self.db.execute(
                "UPDATE campaigns SET status=?,progress=? WHERE id=?",
                (status, text, cid),
            )

    def add_candidate(self, cid, person):
        url = canonical(person["url"])
        status = (person.get("photo_frame") or {}).get("status", "unknown")
        segment = "open" if status == "open_to_work" else "neutral"
        with self.db:
            self.db.execute(
                "INSERT OR IGNORE INTO candidates(id,campaign_id,url,data,segment,observed) VALUES(?,?,?,?,?,?)",
                (
                    uid(),
                    cid,
                    url,
                    json.dumps(person, ensure_ascii=False),
                    segment,
                    now(),
                ),
            )

    def update_campaign(self, cid, data):
        """Rename, change the search size, or fix the search before collection."""
        campaign = self.campaign(cid)
        if campaign["status"] == "archived":
            raise AppError("Кампания в архиве. Сначала верните её из архива.")
        name = str(data.get("name", campaign["name"])).strip()
        if not name or len(name) > 150:
            raise AppError("Укажите название кампании (до 150 символов).")
        try:
            limit = int(data.get("max_profiles", campaign["max_profiles"]))
        except (TypeError, ValueError):
            limit = 0
        if not 1 <= limit <= 100:
            raise AppError("Число профилей — от 1 до 100.")
        keywords = str(data.get("keywords", campaign["keywords"])).strip()
        if keywords != campaign["keywords"]:
            count = self.rows(
                "SELECT COUNT(*) AS n FROM candidates WHERE campaign_id=?", (cid,)
            )[0]["n"]
            if count:
                raise AppError(
                    "Поиск уже собрал профили, поэтому запрос изменить нельзя. "
                    "Создайте новую кампанию с другим запросом."
                )
            if not keywords or len(keywords) > 1000:
                raise AppError("Укажите поисковый запрос (до 1000 символов).")
        if limit != campaign["max_profiles"] or keywords != campaign["keywords"]:
            self.ensure_idle(cid)
        with self.db:
            self.db.execute(
                "UPDATE campaigns SET name=?,max_profiles=?,keywords=? WHERE id=?",
                (name, limit, keywords, cid),
            )
        return self.campaign(cid)

    def archive_campaign(self, cid):
        """Hide a finished or unwanted campaign; its history keeps protecting
        recipients from a repeated contact."""
        self.ensure_idle(cid)
        with self.db:
            self.db.execute(
                "UPDATE outreach_runs SET status='paused',detail='Кампания перенесена в архив.',updated=? "
                "WHERE campaign_id=? AND status='active'",
                (now(), cid),
            )
            self.db.execute(
                "UPDATE campaigns SET status='archived',progress='Кампания в архиве. История сохранена.' WHERE id=?",
                (cid,),
            )
        return self.campaign(cid)

    def restore_campaign(self, cid):
        campaign = self.campaign(cid)
        if campaign["status"] != "archived":
            return campaign
        account = self.account(campaign["account_id"], include_deleted=True)
        if account["status"] == "deleted":
            raise AppError(
                "Аккаунт этой кампании удалён. Кампанию можно только просматривать."
            )
        self.progress(
            cid,
            "ready",
            "Кампания возвращена из архива. Утверждённый ранее план на паузе.",
        )
        return self.campaign(cid)

    def contacted(self, cid):
        """Whether anything was ever sent or attempted for this campaign."""
        return bool(
            self.rows(
                "SELECT 1 FROM outreach_actions a JOIN outreach_members m ON m.id=a.member_id "
                "JOIN outreach_runs r ON r.id=m.run_id WHERE r.campaign_id=? LIMIT 1",
                (cid,),
            )
            or self.rows(
                "SELECT 1 FROM outreach_members m JOIN outreach_runs r ON r.id=m.run_id "
                "WHERE r.campaign_id=? AND (m.sent_at IS NOT NULL OR m.invitation_at IS NOT NULL) LIMIT 1",
                (cid,),
            )
            or self.rows(
                "SELECT 1 FROM deliveries d JOIN batches b ON b.id=d.batch_id "
                "WHERE b.campaign_id=? LIMIT 1",
                (cid,),
            )
        )

    def delete_campaign(self, cid):
        """Delete only campaigns that never contacted anyone."""
        campaign = self.campaign(cid)
        if campaign["status"] != "archived":
            self.ensure_idle(cid)
        if self.contacted(cid):
            raise AppError(
                "По этой кампании уже были обращения. Её можно только перенести "
                "в архив — история защищает людей от повторных сообщений."
            )
        with self.db:
            self.db.execute(
                "DELETE FROM outreach_members WHERE run_id IN (SELECT id FROM outreach_runs WHERE campaign_id=?)",
                (cid,),
            )
            for table in (
                "outreach_runs",
                "batches",
                "candidates",
                "outreach_settings",
            ):
                self.db.execute(f"DELETE FROM {table} WHERE campaign_id=?", (cid,))
            self.db.execute("DELETE FROM campaigns WHERE id=?", (cid,))
        return {"deleted": True}

    def ensure_idle(self, cid):
        campaign = self.campaign(cid)
        self.account(campaign["account_id"])
        if campaign["status"] == "archived":
            raise AppError("Кампания в архиве. Её история доступна только для чтения.")
        if campaign["status"] in (
            "collecting",
            "sending",
            "automating",
            "checking",
        ):
            raise AppError("Сначала приостановите обработку кампании.")

    def invalidate(self, cid, *, previews_only=False):
        approved = not previews_only and (
            (
                hasattr(self, "outreach")
                and self.rows(
                    "SELECT 1 FROM outreach_runs WHERE campaign_id=? AND status IN ('active','paused')",
                    (cid,),
                )
            )
            or self.rows(
                "SELECT 1 FROM batches WHERE campaign_id=? AND status='approved'",
                (cid,),
            )
        )
        if hasattr(self, "outreach"):
            self.outreach.invalidate(cid, previews_only=previews_only)
        self.db.execute(
            "UPDATE batches SET status='cancelled' WHERE campaign_id=? AND "
            + (
                "status='preview'"
                if previews_only
                else "status IN ('preview','approved')"
            ),
            (cid,),
        )
        self.db.execute(
            "UPDATE deliveries SET status='cancelled' WHERE status='pending' AND batch_id IN (SELECT id FROM batches WHERE campaign_id=? AND status='cancelled')",
            (cid,),
        )
        if approved:
            self.db.execute(
                "UPDATE campaigns SET status='paused',progress='План остановлен после изменений. Проверьте и подтвердите новый запуск.' WHERE id=?",
                (cid,),
            )

    def review(self, pid, segment, selected, excluded=False):
        person = self.one("SELECT * FROM candidates WHERE id=?", (pid,))
        if type(selected) is not bool or type(excluded) is not bool:
            raise AppError("Выбор профиля должен быть переключателем.")
        if segment not in ("open", "neutral", "review"):
            raise AppError("Неизвестная группа.")
        if segment == "review" and selected:
            raise AppError("Сначала проверьте профиль и выберите группу сообщения.")
        with self.atomic():
            person = self.one("SELECT * FROM candidates WHERE id=?", (pid,))
            if (segment, int(selected and not excluded), int(excluded)) == (
                person["segment"],
                person["selected"],
                person["excluded"],
            ):
                return
            self.ensure_idle(person["campaign_id"])
            data = json.loads(person["data"])
            if segment != person["segment"]:
                data["manual_review"] = {"segment": segment, "at": now()}
            self.invalidate(person["campaign_id"])
            self.db.execute(
                "UPDATE candidates SET segment=?,selected=?,excluded=?,data=? WHERE id=?",
                (
                    segment,
                    int(bool(selected) and not excluded),
                    int(bool(excluded)),
                    json.dumps(data, ensure_ascii=False),
                    pid,
                ),
            )

    def templates(self, cid, opened, neutral):
        self.validate_templates(opened, neutral)
        with self.atomic():
            campaign = self.campaign(cid)
            if (opened, neutral) == (
                campaign["template_open"],
                campaign["template_neutral"],
            ):
                return
            self.ensure_idle(cid)
            self.invalidate(cid)
            self.db.execute(
                "UPDATE campaigns SET template_open=?,template_neutral=?,revision=revision+1 WHERE id=?",
                (opened, neutral, cid),
            )

    @staticmethod
    def validate_templates(opened, neutral):
        if any(
            not isinstance(value, str) or len(value) > 4000
            for value in (opened, neutral)
        ):
            raise AppError("Шаблон должен быть текстом до 4000 символов.")

    def save_automation(self, cid, value, opened, neutral):
        from .outreach import validate_rules

        rules = validate_rules(value)
        self.validate_templates(opened, neutral)
        with self.atomic():
            campaign = self.campaign(cid)
            if rules == self.outreach.rules(cid) and (opened, neutral) == (
                campaign["template_open"],
                campaign["template_neutral"],
            ):
                return {"saved": True, "changed": False}
            self.ensure_idle(cid)
            self.invalidate(cid)
            self.db.execute(
                "INSERT OR REPLACE INTO outreach_settings VALUES(?,?)",
                (cid, json.dumps(rules)),
            )
            self.db.execute(
                "UPDATE campaigns SET template_open=?,template_neutral=?,revision=revision+1 WHERE id=?",
                (opened, neutral, cid),
            )
        return {"saved": True, "changed": True}

    def select_many(self, cid, ids, selected):
        if (
            not isinstance(ids, list)
            or type(selected) is not bool
            or any(not isinstance(pid, str) or not pid for pid in ids)
        ):
            raise AppError("Передайте список профилей и переключатель выбора.")
        ids = list(dict.fromkeys(ids))
        with self.atomic():
            campaign = self.campaign(cid)
            people = {
                p["id"]: p
                for p in self.rows(
                    "SELECT * FROM candidates WHERE campaign_id=?", (cid,)
                )
            }
            if any(pid not in people for pid in ids):
                raise AppError("Все профили должны принадлежать выбранной кампании.")
            if selected and any(
                self.outreach.exclusion(people[pid], campaign) for pid in ids
            ):
                raise AppError(
                    "В выборе есть недоступные профили. Обновите список получателей."
                )
            changed = [pid for pid in ids if people[pid]["selected"] != int(selected)]
            if not changed:
                return {"saved": True, "changed": 0}
            self.ensure_idle(cid)
            self.invalidate(cid)
            self.db.executemany(
                "UPDATE candidates SET selected=? WHERE id=?",
                [(int(selected), pid) for pid in changed],
            )
        return {"saved": True, "changed": len(changed)}

    def suppress(self, url, reason):
        url = canonical(url)
        with self.db:
            self.db.execute(
                "INSERT OR REPLACE INTO suppression VALUES(?,?,?)",
                (url, reason[:300], now()),
            )
            self.db.execute(
                "UPDATE deliveries SET status='cancelled',detail='Не контактировать',updated=? WHERE url=? AND status='pending'",
                (now(), url),
            )

    def finish(self, did, status, detail="", thread_id=None):
        if status not in ("sent", "unknown", "failed", "blocked", "replied"):
            raise AppError("Неверный результат отправки.")
        with self.db:
            self.db.execute(
                "UPDATE deliveries SET status=?,detail=?,thread_id=COALESCE(?,thread_id),updated=? WHERE id=?",
                (status, str(detail)[:1000], thread_id, now(), did),
            )

    def export(self, cid, fmt):
        from .export import export_campaign

        return export_campaign(self, cid, fmt)

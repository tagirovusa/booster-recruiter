from __future__ import annotations

import csv
import hashlib
import io
import json
import re
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from string import Formatter

from booster_linkedin.linkedin.identifiers import (
    normalize_person_identifier,
    person_profile_url,
)


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
    def __init__(self, root: Path):
        self.root = root
        root.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.db = sqlite3.connect(root / "workspace.sqlite3")
        self.db.row_factory = sqlite3.Row
        self.db.executescript("""
          PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
          CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY,label TEXT NOT NULL,url TEXT,status TEXT NOT NULL DEFAULT 'new',error TEXT,created TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS campaigns(id TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES accounts(id),name TEXT NOT NULL,keywords TEXT NOT NULL,max_profiles INTEGER NOT NULL,template_open TEXT NOT NULL,template_neutral TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'draft',progress TEXT NOT NULL DEFAULT '',created TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1);
          CREATE TABLE IF NOT EXISTS candidates(id TEXT PRIMARY KEY,campaign_id TEXT NOT NULL REFERENCES campaigns(id),url TEXT NOT NULL,data TEXT NOT NULL,segment TEXT NOT NULL DEFAULT 'review',selected INTEGER NOT NULL DEFAULT 0,excluded INTEGER NOT NULL DEFAULT 0,observed TEXT NOT NULL,UNIQUE(campaign_id,url));
          CREATE TABLE IF NOT EXISTS batches(id TEXT PRIMARY KEY,campaign_id TEXT NOT NULL REFERENCES campaigns(id),account_id TEXT NOT NULL REFERENCES accounts(id),digest TEXT NOT NULL,status TEXT NOT NULL,created TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS deliveries(id TEXT PRIMARY KEY,batch_id TEXT NOT NULL REFERENCES batches(id),candidate_id TEXT NOT NULL REFERENCES candidates(id),url TEXT NOT NULL,message TEXT NOT NULL,status TEXT NOT NULL,detail TEXT,thread_id TEXT,created TEXT NOT NULL,updated TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS suppression(url TEXT PRIMARY KEY,reason TEXT NOT NULL,created TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY,created TEXT NOT NULL,kind TEXT NOT NULL,detail TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS migrations(name TEXT PRIMARY KEY,applied TEXT NOT NULL);
          PRAGMA user_version=1;
        """)
        # Recovery never retries an operation which may already have sent.
        with self.db:
            self.db.execute(
                "UPDATE deliveries SET status='unknown',detail='Приложение завершилось во время отправки. Проверьте диалог.',updated=? WHERE status='sending'",
                (now(),),
            )
            self.db.execute(
                "UPDATE campaigns SET status='paused',progress='Работа приостановлена после перезапуска.' WHERE status IN ('collecting','sending')"
            )
            self.db.execute(
                "UPDATE accounts SET status='needs_login' WHERE status='connecting'"
            )
        self._migrate_neutral_default()

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

    def account(self, aid):
        return self.one("SELECT * FROM accounts WHERE id=?", (aid,))

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
                "UPDATE accounts SET status=?,url=COALESCE(?,url),error=?,label=COALESCE(?,label) WHERE id=?",
                (
                    status,
                    canonical(url) if url else None,
                    error,
                    name if status == "ready" else None,
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
        return self.campaign(cid)

    def state(self):
        return {
            "accounts": self.rows("SELECT * FROM accounts ORDER BY created DESC"),
            "campaigns": self.rows(
                "SELECT c.*,(SELECT COUNT(*) FROM candidates p WHERE p.campaign_id=c.id) AS count FROM campaigns c ORDER BY created DESC"
            ),
            "events": self.rows("SELECT * FROM events ORDER BY id DESC LIMIT 30"),
        }

    def detail(self, cid):
        campaign = self.campaign(cid)
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
        return {
            "campaign": campaign,
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

    def ensure_idle(self, cid):
        if self.campaign(cid)["status"] in ("collecting", "sending"):
            raise AppError("Сначала приостановите обработку кампании.")

    def invalidate(self, cid):
        self.db.execute(
            "UPDATE batches SET status='cancelled' WHERE campaign_id=? AND status IN ('preview','approved')",
            (cid,),
        )
        self.db.execute(
            "UPDATE deliveries SET status='cancelled' WHERE status='pending' AND batch_id IN (SELECT id FROM batches WHERE campaign_id=? AND status='cancelled')",
            (cid,),
        )

    def review(self, pid, segment, selected, excluded=False):
        person = self.one("SELECT * FROM candidates WHERE id=?", (pid,))
        self.ensure_idle(person["campaign_id"])
        if segment not in ("open", "neutral", "review"):
            raise AppError("Неизвестная группа.")
        if segment == "review" and selected:
            raise AppError("Сначала проверьте профиль и выберите группу сообщения.")
        data = json.loads(person["data"])
        if segment != person["segment"]:
            data["manual_review"] = {"segment": segment, "at": now()}
        with self.db:
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
        self.ensure_idle(cid)
        if len(opened) > 4000 or len(neutral) > 4000:
            raise AppError("Шаблон слишком длинный.")
        with self.db:
            self.invalidate(cid)
            self.db.execute(
                "UPDATE campaigns SET template_open=?,template_neutral=?,revision=revision+1 WHERE id=?",
                (opened, neutral, cid),
            )

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

    def preview(self, cid):
        self.ensure_idle(cid)
        campaign = self.campaign(cid)
        account = self.account(campaign["account_id"])
        if account["status"] != "ready":
            raise AppError("Подключите аккаунт отправителя.")
        chosen = self.rows(
            "SELECT * FROM candidates WHERE campaign_id=? AND selected=1 AND excluded=0",
            (cid,),
        )
        messages, skipped = [], []
        for p in chosen:
            if p["segment"] == "review":
                continue
            if self.rows(
                "SELECT url FROM suppression WHERE url=?", (p["url"],)
            ) or self.rows(
                "SELECT id FROM deliveries WHERE url=? AND status IN ('sending','sent','unknown','replied','invited')",
                (p["url"],),
            ):
                skipped.append(p["url"])
                continue
            data = json.loads(p["data"])
            template = campaign[
                "template_open" if p["segment"] == "open" else "template_neutral"
            ]
            messages.append(
                {
                    "id": uid(),
                    "candidate_id": p["id"],
                    "url": p["url"],
                    "name": data.get("name", ""),
                    "message": message_for(template, data),
                }
            )
        if not messages:
            raise AppError(
                "Нет выбранных получателей без предыдущих отправок или запрета контакта."
            )
        # Preview freezes the exact account, recipients and final messages.
        digest = hashlib.sha256(
            json.dumps([campaign["account_id"], messages], sort_keys=True).encode()
        ).hexdigest()
        bid = uid()
        with self.db:
            self.invalidate(cid)
            self.db.execute(
                "INSERT INTO batches VALUES(?,?,?,?,?,?)",
                (bid, cid, campaign["account_id"], digest, "preview", now()),
            )
            for m in messages:
                self.db.execute(
                    "INSERT INTO deliveries(id,batch_id,candidate_id,url,message,status,created,updated) VALUES(?,?,?,?,?,'pending',?,?)",
                    (
                        m["id"],
                        bid,
                        m["candidate_id"],
                        m["url"],
                        m["message"],
                        now(),
                        now(),
                    ),
                )
        return {
            "batch_id": bid,
            "digest": digest,
            "account": account,
            "messages": messages,
            "skipped": skipped,
        }

    def approve(self, bid, digest):
        batch = self.one("SELECT * FROM batches WHERE id=?", (bid,))
        self.ensure_idle(batch["campaign_id"])
        if batch["status"] != "preview" or batch["digest"] != digest:
            raise AppError("Предпросмотр устарел. Подготовьте сообщения снова.")
        with self.db:
            self.db.execute("UPDATE batches SET status='approved' WHERE id=?", (bid,))
        self.event("approval", f"Подтверждена очередь {bid}")
        return batch

    def claim(self, bid):
        with self.db:
            rows = self.rows(
                "SELECT d.* FROM deliveries d JOIN batches b ON b.id=d.batch_id WHERE d.batch_id=? AND d.status='pending' AND b.status='approved' ORDER BY d.created,d.id LIMIT 1",
                (bid,),
            )
            if not rows:
                return None
            row = rows[0]
            if self.rows(
                "SELECT url FROM suppression WHERE url=?", (row["url"],)
            ) or self.rows(
                "SELECT id FROM deliveries WHERE url=? AND id!=? AND status IN ('sending','sent','unknown','replied')",
                (row["url"], row["id"]),
            ):
                self.db.execute(
                    "UPDATE deliveries SET status='cancelled',detail='Повторный контакт исключён',updated=? WHERE id=?",
                    (now(), row["id"]),
                )
                return {"skip": True}
            self.db.execute(
                "UPDATE deliveries SET status='sending',updated=? WHERE id=? AND status='pending'",
                (now(), row["id"]),
            )
            return row

    def finish(self, did, status, detail="", thread_id=None):
        if status not in ("sent", "unknown", "failed", "blocked", "replied"):
            raise AppError("Неверный результат отправки.")
        with self.db:
            self.db.execute(
                "UPDATE deliveries SET status=?,detail=?,thread_id=COALESCE(?,thread_id),updated=? WHERE id=?",
                (status, str(detail)[:1000], thread_id, now(), did),
            )

    def export(self, cid, fmt):
        data = self.detail(cid)
        columns = [
            "Имя",
            "Профиль",
            "Заголовок",
            "Компания",
            "Местоположение",
            "Группа",
            "Рамка",
            "Проверено",
            "Статус сообщения",
            "Текст сообщения",
            "Комментарий",
        ]
        rows = []
        for p in data["candidates"]:
            d = p["data"]
            sent = (p["delivery"] or [{}])[0]
            rows.append(
                [
                    d.get("name", ""),
                    p["url"],
                    d.get("headline", ""),
                    d.get("company", ""),
                    d.get("location", ""),
                    p["segment"],
                    d.get("photo_frame", {}).get("status", "unknown"),
                    p["observed"],
                    sent.get("status", ""),
                    sent.get("message", ""),
                    sent.get("detail", ""),
                ]
            )
        if fmt == "csv":
            stream = io.StringIO(newline="")
            writer = csv.writer(stream)
            writer.writerow(columns)
            for row in rows:
                writer.writerow(
                    [
                        "'" + str(c)
                        if str(c).lstrip().startswith(("=", "+", "-", "@"))
                        else c
                        for c in row
                    ]
                )
            return stream.getvalue().encode("utf-8-sig")
        if fmt != "xlsx":
            raise AppError("Поддерживается Excel или CSV.")
        from openpyxl import Workbook
        from openpyxl.styles import Font, PatternFill

        wb = Workbook()
        ws = wb.active
        ws.title = "Кандидаты"
        ws.append(columns)
        for row in rows:
            ws.append(row)
            for cell in ws[ws.max_row]:
                cell.data_type = "s"
        ws.freeze_panes = "C2"
        ws.auto_filter.ref = ws.dimensions
        for cell in ws[1]:
            cell.fill = PatternFill("solid", fgColor="FED700")
            cell.font = Font(bold=True)
        for letter in "ABCDEFGHIJK":
            ws.column_dimensions[letter].width = 28 if letter != "J" else 70
        out = io.BytesIO()
        wb.save(out)
        return out.getvalue()

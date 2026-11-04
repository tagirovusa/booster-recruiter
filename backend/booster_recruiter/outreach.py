"""Durable, approved outreach plans. No browser calls or implicit approvals here."""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from .store import AppError, message_for, now, uid

DEFAULT_RULES = {
    "allow_invites": True,
    "allow_inmail": False,
    "inmail_channel": "linkedin",
    "strategy": "economy",
    "wait_days": 7,
    "check_hours": 12,
    "invitation": "",
    "subject_open": "",
    "subject_neutral": "",
    "inmail_open": "",
    "inmail_neutral": "",
    "timezone": "UTC",
    "start_hour": 8,
    "end_hour": 20,
    "monitor_days": 30,
}
# Read old saved plans and older MCP clients without reinstating retired caps.
RETIRED_QUOTAS = {"daily_invites", "daily_messages", "daily_inmails", "inmail_budget"}


def current_rules(value):
    return DEFAULT_RULES | {k: v for k, v in value.items() if k not in RETIRED_QUOTAS}


ACTION_KINDS = {"invite", "message", "inmail"}
TERMINAL = {"replied", "excluded", "unavailable", "needs_review", "finished"}


def utc(value=None):
    return datetime.fromisoformat(value) if value else datetime.now(timezone.utc)


def later(hours=0, days=0):
    return (utc() + timedelta(hours=hours, days=days)).isoformat()


def validate_rules(value):
    if not isinstance(value, dict) or set(value) - (
        set(DEFAULT_RULES) | RETIRED_QUOTAS
    ):
        raise AppError("Неизвестные настройки автоматизации.")
    rules = current_rules(value)
    for key in ("allow_invites", "allow_inmail"):
        if type(rules[key]) is not bool:
            raise AppError("Параметр разрешения должен быть переключателем.")
    for key, low, high in (
        ("wait_days", 1, 60),
        ("check_hours", 1, 72),
        ("start_hour", 0, 23),
        ("end_hour", 1, 24),
        ("monitor_days", 1, 90),
    ):
        if type(rules[key]) is not int or not low <= rules[key] <= high:
            raise AppError(f"Параметр {key}: допустимо от {low} до {high}.")
    if rules["strategy"] not in ("economy", "fast"):
        raise AppError("Выберите экономный или быстрый режим.")
    if rules["inmail_channel"] not in ("linkedin", "recruiter"):
        raise AppError("Выберите LinkedIn Premium или Recruiter для InMail.")
    if rules["start_hour"] >= rules["end_hour"]:
        raise AppError("Время окончания должно быть позже начала в пределах суток.")
    try:
        ZoneInfo(rules["timezone"])
    except (ZoneInfoNotFoundError, TypeError, ValueError) as exc:
        raise AppError("Неизвестный часовой пояс.") from exc
    for key in (
        "invitation",
        "subject_open",
        "subject_neutral",
        "inmail_open",
        "inmail_neutral",
    ):
        if not isinstance(rules[key], str) or len(rules[key]) > 4000:
            raise AppError("Шаблон должен быть текстом до 4000 символов.")
    return rules


def within_hours(rules, at=None):
    local = (at or utc()).astimezone(ZoneInfo(rules["timezone"]))
    return rules["start_hour"] <= local.hour < rules["end_hour"]


def route(rules, observation, invitation_at=None, at=None):
    """A free Message button is not evidence of a 1st-degree connection."""
    if observation.get("identity_verified") is not True:
        return "needs_review", "Не подтверждён владелец открытого профиля."
    if observation.get("has_reply"):
        return "replied", "Человек уже ответил. Продолжите разговор вручную."
    if observation.get("has_outgoing"):
        return (
            "needs_review",
            "В LinkedIn уже есть исходящее сообщение. Повтор исключён.",
        )
    if observation.get("free_message") is True:
        return "message", "Доступно обычное бесплатное сообщение."
    relation = observation.get("relationship", "unknown")
    if relation in ("self", "incoming"):
        return (
            "needs_review",
            "Собственный профиль или входящее приглашение: проверьте вручную.",
        )
    can_paid = rules["allow_inmail"] and observation.get("inmail") is True
    if relation == "connected" and not can_paid:
        return "unavailable", "Контакт подтверждён, но отправка сообщения недоступна."
    if can_paid and observation.get("inmail_free") is True:
        return "inmail", "В Recruiter доступен InMail без расхода кредита."
    if rules["strategy"] == "fast" and can_paid:
        if type(observation.get("credits")) is int and observation["credits"] == 0:
            if relation == "pending" or invitation_at:
                return (
                    "waiting_acceptance",
                    "Кредитов нет; ожидаем принятия существующего приглашения.",
                )
            if rules["allow_invites"] and observation.get("can_invite") is True:
                return "invite", "Кредитов нет; используем разрешённое приглашение."
        return "inmail", "Быстрый режим: разрешён InMail."
    pending = relation == "pending" or invitation_at is not None
    if pending:
        if invitation_at and (at or utc()) >= utc(invitation_at) + timedelta(
            days=rules["wait_days"]
        ):
            if can_paid:
                return "inmail", "Срок ожидания принятия приглашения истёк."
        return "waiting_acceptance", "Ожидаем подтверждённого принятия приглашения."
    if rules["allow_invites"] and observation.get("can_invite") is True:
        return "invite", "Отправить утверждённое приглашение."
    if can_paid:
        return "inmail", "Бесплатная связь и приглашение недоступны."
    if observation.get("inmail") is True:
        return "unavailable", "Доступен только InMail; он не разрешён в этой кампании."
    return "needs_review", "Доступный способ связи не удалось подтвердить."


class OutreachStore:
    def __init__(self, store):
        self.s = store
        self.db = store.db
        self.db.executescript("""
        CREATE TABLE IF NOT EXISTS outreach_settings(campaign_id TEXT PRIMARY KEY REFERENCES campaigns(id),rules TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS outreach_runs(id TEXT PRIMARY KEY,campaign_id TEXT NOT NULL REFERENCES campaigns(id),account_id TEXT NOT NULL REFERENCES accounts(id),digest TEXT NOT NULL,rules TEXT NOT NULL,status TEXT NOT NULL,created TEXT NOT NULL,updated TEXT NOT NULL,detail TEXT NOT NULL DEFAULT '');
        CREATE TABLE IF NOT EXISTS outreach_members(id TEXT PRIMARY KEY,run_id TEXT NOT NULL REFERENCES outreach_runs(id),candidate_id TEXT NOT NULL REFERENCES candidates(id),url TEXT NOT NULL,name TEXT NOT NULL,message TEXT NOT NULL,invitation TEXT NOT NULL,subject TEXT NOT NULL,inmail_message TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'planned',detail TEXT NOT NULL DEFAULT '',relationship TEXT NOT NULL DEFAULT 'unknown',observation TEXT NOT NULL DEFAULT '{}',invitation_at TEXT,checked_at TEXT,next_check TEXT NOT NULL,thread_id TEXT,sent_at TEXT,updated TEXT NOT NULL,UNIQUE(run_id,url));
        CREATE TABLE IF NOT EXISTS outreach_actions(id TEXT PRIMARY KEY,member_id TEXT NOT NULL REFERENCES outreach_members(id),account_id TEXT NOT NULL REFERENCES accounts(id),url TEXT NOT NULL,kind TEXT NOT NULL,status TEXT NOT NULL,detail TEXT NOT NULL DEFAULT '',thread_id TEXT,created TEXT NOT NULL,updated TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS outreach_due ON outreach_members(next_check,status);
        CREATE INDEX IF NOT EXISTS outreach_action_recipient ON outreach_actions(url,status);
        CREATE TABLE IF NOT EXISTS app_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
        """)
        with self.db:
            if "context" not in {
                r["name"] for r in self.s.rows("PRAGMA table_info(outreach_runs)")
            }:
                self.db.execute(
                    "ALTER TABLE outreach_runs ADD COLUMN context TEXT NOT NULL DEFAULT '{}'"
                )
            if "credit_cost" not in {
                r["name"] for r in self.s.rows("PRAGMA table_info(outreach_actions)")
            }:
                self.db.execute(
                    "ALTER TABLE outreach_actions ADD COLUMN credit_cost INTEGER"
                )
            if "reply_text" not in {
                r["name"] for r in self.s.rows("PRAGMA table_info(outreach_members)")
            }:
                self.db.execute(
                    "ALTER TABLE outreach_members ADD COLUMN reply_text TEXT NOT NULL DEFAULT ''"
                )
            self.db.execute(
                "UPDATE outreach_members SET status='needs_review',detail='Приложение завершилось во время действия. Проверьте результат в LinkedIn.' WHERE id IN (SELECT member_id FROM outreach_actions WHERE status='submitting')"
            )
            self.db.execute(
                "UPDATE outreach_actions SET status='unknown',detail='Ответ браузера потерян при завершении приложения.',updated=? WHERE status='submitting'",
                (now(),),
            )
            # A retired application cap is no longer a reason to wait. Preserve
            # schedule, approval, and unknown-result guards during the upgrade.
            self.db.execute(
                "UPDATE outreach_members SET status='planned',detail='' "
                "WHERE status='waiting_budget' AND detail IN (?,?) "
                "AND NOT EXISTS (SELECT 1 FROM outreach_actions a WHERE a.member_id=outreach_members.id "
                "AND a.status IN ('unknown','submitting'))",
                (
                    "Достигнут дневной бюджет приложения для этого канала (UTC).",
                    "Исчерпан утверждённый бюджет InMail этой кампании.",
                ),
            )
            # A read-only contact check or a Recruiter preview has no queue to
            # restore; only campaigns with an active plan wait for the schedule.
            self.db.execute(
                "UPDATE campaigns SET status='ready',progress='Проверка прервана перезапуском приложения. Запустите её ещё раз, если она нужна.' "
                "WHERE status='checking' AND NOT EXISTS (SELECT 1 FROM outreach_runs r WHERE r.campaign_id=campaigns.id AND r.status='active')"
            )
            self.db.execute(
                "UPDATE campaigns SET status='waiting',progress='Утверждённая очередь восстановлена. Ожидаем расписания.' WHERE status IN ('automating','checking')"
            )

    def rules(self, cid):
        self.s.campaign(cid)
        rows = self.s.rows(
            "SELECT rules FROM outreach_settings WHERE campaign_id=?", (cid,)
        )
        return current_rules(json.loads(rows[0]["rules"]) if rows else {})

    def configure(self, cid, value):
        rules = validate_rules(value)
        with self.s.atomic():
            if rules == self.rules(cid):
                return rules
            self.s.ensure_idle(cid)
            self.s.invalidate(cid)
            self.db.execute(
                "INSERT OR REPLACE INTO outreach_settings VALUES(?,?)",
                (cid, json.dumps(rules)),
            )
        return rules

    def invalidate(self, cid, *, previews_only=False):
        self.db.execute(
            "UPDATE outreach_runs SET status='cancelled',detail='Состав или настройки кампании изменились.',updated=? WHERE campaign_id=? AND "
            + (
                "status='preview'"
                if previews_only
                else "status IN ('preview','active','paused')"
            ),
            (now(), cid),
        )

    def blocked(self, url, member_id=None, campaign_id=None, account_id=None):
        return bool(self.block_reason(url, member_id, campaign_id, account_id))

    def block_reason(self, url, member_id=None, campaign_id=None, account_id=None):
        if self.s.rows("SELECT 1 FROM suppression WHERE url=?", (url,)):
            return "Не контактировать: профиль в списке исключений."
        if self.s.rows(
            "SELECT 1 FROM deliveries WHERE url=? AND status IN ('sent','sending','unknown','replied','invited')",
            (url,),
        ):
            return (
                "Есть прежняя отправка или неподтверждённое действие. Повтор исключён."
            )
        if member_id:
            owner = self.s.one(
                "SELECT r.campaign_id,r.account_id FROM outreach_members m JOIN outreach_runs r ON r.id=m.run_id WHERE m.id=?",
                (member_id,),
            )
            campaign_id, account_id = owner["campaign_id"], owner["account_id"]
        # A replacement plan may continue this campaign's confirmed invitation,
        # but never another sender's invitation or any uncertain/message action.
        for action in self.s.rows(
            "SELECT a.*,r.campaign_id FROM outreach_actions a JOIN outreach_members m ON m.id=a.member_id JOIN outreach_runs r ON r.id=m.run_id WHERE a.url=? AND a.member_id!=? AND a.status IN ('submitting','unknown','sent','satisfied')",
            (url, member_id or ""),
        ):
            from .invitation_repair import covered_invitation_actions

            covered = covered_invitation_actions(self.s, action["member_id"])
            if (
                action["id"] in covered
                and action["campaign_id"] == campaign_id
                and action["account_id"] == account_id
            ):
                continue
            if (
                action["kind"] == "invite"
                and action["status"] in {"sent", "satisfied"}
                and action["campaign_id"] == campaign_id
                and action["account_id"] == account_id
            ):
                continue
            return "Есть прежнее обращение или неподтверждённое действие. Проверьте историю."
        for row in self.s.rows(
            "SELECT b.campaign_id,b.account_id FROM deliveries d JOIN batches b ON b.id=d.batch_id "
            "WHERE d.url=? AND d.status='pending' AND b.status='approved'",
            (url,),
        ):
            if row["campaign_id"] != campaign_id or row["account_id"] != account_id:
                return "Профиль уже включён в другую утверждённую очередь."
        for row in self.s.rows(
            "SELECT r.campaign_id,r.account_id FROM outreach_members m JOIN outreach_runs r ON r.id=m.run_id WHERE m.url=? AND m.id!=? AND r.status IN ('active','paused') AND m.status NOT IN ('excluded','unavailable')",
            (url, member_id or ""),
        ):
            if row["campaign_id"] != campaign_id or row["account_id"] != account_id:
                return "Профиль уже включён в другую действующую кампанию."
        return ""

    def exclusion(self, person, campaign):
        if person["excluded"]:
            return "Профиль исключён из кампании."
        if person["segment"] not in ("open", "neutral"):
            return "Сначала выберите группу сообщения."
        return self.block_reason(
            person["url"], campaign_id=campaign["id"], account_id=campaign["account_id"]
        )

    def latest_member(self, candidate_id, cid, aid):
        rows = self.s.rows(
            "SELECT m.*,r.status AS run_status,"
            "EXISTS(SELECT 1 FROM outreach_actions a WHERE a.member_id=m.id) AS attempted "
            "FROM outreach_members m JOIN outreach_runs r ON r.id=m.run_id "
            "WHERE m.candidate_id=? AND r.campaign_id=? AND r.account_id=? "
            "ORDER BY m.updated DESC,r.created DESC,m.id DESC",
            (candidate_id, cid, aid),
        )
        substantive = [
            m
            for m in rows
            if m["run_status"] != "preview"
            and (
                m["attempted"]
                or m["checked_at"]
                or m["sent_at"]
                or m["reply_text"]
                or m["status"] != "planned"
                or m["run_status"] in ("active", "paused")
            )
        ]
        # A later unused plan must not hide an actual message or a reply.
        outcomes = [
            m
            for m in substantive
            if m["sent_at"] or m["reply_text"] or m["status"] == "replied"
        ]
        if not (outcomes or substantive):
            return None
        member = (outcomes or substantive)[0]
        member.pop("attempted")
        member["observation"] = json.loads(member["observation"])
        return member

    def preview(self, cid, recruiter_context=None):
        with self.s.atomic():
            return self._preview(cid, recruiter_context)

    def _preview(self, cid, recruiter_context=None):
        self.s.ensure_idle(cid)
        campaign = self.s.campaign(cid)
        account = self.s.account(campaign["account_id"])
        if account["status"] != "ready":
            raise AppError("Подключите аккаунт отправителя.")
        rules = validate_rules(self.rules(cid))
        context = {}
        if rules["allow_inmail"] and rules["inmail_channel"] == "recruiter":
            service = account["services"].get("recruiter", {})
            if (
                not recruiter_context
                or service.get("status") != "ready"
                or recruiter_context.get("contract") != service.get("contract")
            ):
                raise AppError(
                    "Подключите Recruiter у отправителя и заново проверьте запуск."
                )
            if not recruiter_context.get("manual_texts"):
                raise AppError(
                    "Отключите автоматические тексты LinkedIn в подключении Recruiter."
                )
            context = recruiter_context
        members, skipped = [], []
        for p in self.s.rows(
            "SELECT * FROM candidates WHERE campaign_id=? AND selected=1 AND excluded=0 ORDER BY observed,id",
            (cid,),
        ):
            if p["segment"] == "review" or self.blocked(
                p["url"], campaign_id=cid, account_id=account["id"]
            ):
                skipped.append(p["url"])
                continue
            data = json.loads(p["data"])
            segment = "open" if p["segment"] == "open" else "neutral"
            message = message_for(campaign["template_" + segment], data)
            invitation = (
                message_for(rules["invitation"], data)
                if rules["allow_invites"] and rules["invitation"].strip()
                else ""
            )
            subject = (
                message_for(rules["subject_" + segment], data)
                if rules["allow_inmail"]
                else ""
            )
            if len(invitation) > 200 or len(subject) > 200 or "\n" in subject:
                raise AppError(
                    "Приглашение и тема InMail: до 200 символов; тема — одна строка."
                )
            inmail = (
                message_for(
                    rules["inmail_" + segment] or campaign["template_" + segment], data
                )
                if rules["allow_inmail"]
                else ""
            )
            if inmail and context.get("signature"):
                inmail += "\n\n" + context["signature"]
                if len(inmail) > 1900:
                    raise AppError(
                        "Текст вместе с подписью Recruiter превышает 1900 символов."
                    )
            members.append(
                {
                    "id": uid(),
                    "candidate_id": p["id"],
                    "url": p["url"],
                    "name": data.get("name", ""),
                    "message": message,
                    "invitation": invitation,
                    "subject": subject,
                    "inmail_message": inmail,
                }
            )
        if not members:
            raise AppError(
                "Нет выбранных получателей без прежних обращений или активной кампании."
            )
        rid = uid()
        digest = hashlib.sha256(
            json.dumps(
                [account["id"], account["url"], rules, context, members], sort_keys=True
            ).encode()
        ).hexdigest()
        with self.s.atomic():
            self.s.ensure_idle(cid)
            self.s.invalidate(cid, previews_only=True)
            self.db.execute(
                "INSERT INTO outreach_runs(id,campaign_id,account_id,digest,rules,context,status,created,updated) VALUES(?,?,?,?,?,?,'preview',?,?)",
                (
                    rid,
                    cid,
                    account["id"],
                    digest,
                    json.dumps(rules),
                    json.dumps(context),
                    now(),
                    now(),
                ),
            )
            for m in members:
                self.db.execute(
                    "INSERT INTO outreach_members(id,run_id,candidate_id,url,name,message,invitation,subject,inmail_message,next_check,updated) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                    (
                        m["id"],
                        rid,
                        m["candidate_id"],
                        m["url"],
                        m["name"],
                        m["message"],
                        m["invitation"],
                        m["subject"],
                        m["inmail_message"],
                        now(),
                        now(),
                    ),
                )
                previous = self.s.rows(
                    "SELECT m.invitation_at FROM outreach_members m JOIN outreach_runs r ON r.id=m.run_id WHERE r.campaign_id=? AND r.account_id=? AND m.url=? AND m.invitation_at IS NOT NULL ORDER BY m.invitation_at LIMIT 1",
                    (cid, account["id"], m["url"]),
                )
                if previous:
                    self.db.execute(
                        "UPDATE outreach_members SET invitation_at=? WHERE id=?",
                        (previous[0]["invitation_at"], m["id"]),
                    )
        return {
            "run_id": rid,
            "digest": digest,
            "account": account,
            "rules": rules,
            "context": context,
            "messages": members,
            "skipped": skipped,
            "maximum_credits": len(members) if rules["allow_inmail"] else 0,
        }

    def run(self, rid):
        row = self.s.one("SELECT * FROM outreach_runs WHERE id=?", (rid,))
        row["rules"] = current_rules(json.loads(row["rules"]))
        row["context"] = json.loads(row["context"])
        return row

    def approve(self, rid, digest):
        with self.s.atomic():
            run = self.run(rid)
            self.s.ensure_idle(run["campaign_id"])
            if run["status"] != "preview" or run["digest"] != digest:
                raise AppError("Предпросмотр устарел. Подготовьте кампанию снова.")
            account = self.s.account(run["account_id"])
            if account["status"] != "ready":
                raise AppError("Сначала подтвердите вход отправителя.")
            campaign = self.s.campaign(run["campaign_id"])
            if (
                run["rules"] != self.rules(run["campaign_id"])
                or campaign["account_id"] != run["account_id"]
            ):
                raise AppError("Настройки изменились. Подготовьте кампанию снова.")
            if run["context"] and account["services"].get("recruiter", {}).get(
                "contract"
            ) != run["context"].get("contract"):
                raise AppError(
                    "Подключение Recruiter изменилось. Обновите предпросмотр."
                )
            for m in self.members(rid):
                person = self.s.one(
                    "SELECT * FROM candidates WHERE id=?", (m["candidate_id"],)
                )
                if (
                    person["campaign_id"] != run["campaign_id"]
                    or not person["selected"]
                    or self.exclusion(person, campaign)
                    or self.blocked(m["url"], m["id"])
                ):
                    raise AppError(
                        "Один из получателей уже обрабатывается. Обновите предпросмотр."
                    )
                # The old approved run may have confirmed an invitation after
                # this preview was created. Continue its wait without resending.
                prior = self.s.rows(
                    "SELECT m.invitation_at FROM outreach_members m JOIN outreach_runs r ON r.id=m.run_id "
                    "WHERE r.campaign_id=? AND r.account_id=? AND m.url=? AND m.id!=? "
                    "AND m.invitation_at IS NOT NULL ORDER BY m.invitation_at LIMIT 1",
                    (run["campaign_id"], run["account_id"], m["url"], m["id"]),
                )
                if prior:
                    self.db.execute(
                        "UPDATE outreach_members SET invitation_at=?,status='waiting_acceptance',"
                        "detail='Приглашение уже отправлено; ожидаем принятия.' WHERE id=?",
                        (prior[0]["invitation_at"], m["id"]),
                    )
            self.s.invalidate(run["campaign_id"])
            self.db.execute(
                "UPDATE outreach_runs SET status='active',detail='',updated=? WHERE id=?",
                (now(), rid),
            )
            self.db.execute(
                "UPDATE campaigns SET status='waiting',progress='План утверждён. Ожидаем запуска по расписанию.' WHERE id=?",
                (run["campaign_id"],),
            )
        self.s.event(
            "outreach_approval",
            f"Утверждён план {rid}: получатели, тексты, расписание и способы связи.",
        )
        return self.run(rid)

    def members(self, rid):
        rows = self.s.rows(
            "SELECT * FROM outreach_members WHERE run_id=? ORDER BY next_check,id",
            (rid,),
        )
        for row in rows:
            row["observation"] = json.loads(row["observation"])
        return rows

    def detail(self, cid):
        runs = self.s.rows(
            "SELECT * FROM outreach_runs WHERE campaign_id=? ORDER BY created DESC",
            (cid,),
        )
        for run in runs:
            run["rules"] = current_rules(json.loads(run["rules"]))
            run["context"] = json.loads(run["context"])
            run["members"] = self.members(run["id"])
            run["actions"] = self.s.rows(
                "SELECT a.* FROM outreach_actions a JOIN outreach_members m ON m.id=a.member_id WHERE m.run_id=? ORDER BY a.created DESC",
                (run["id"],),
            )
            from .invitation_repair import covered_invitation_actions

            for member in run["members"]:
                covered = covered_invitation_actions(self.s, member["id"])
                for action in run["actions"]:
                    if action["id"] in covered:
                        action["repair_replaced_by"] = covered[action["id"]]
            run["credits_reserved"] = sum(
                (1 if a["credit_cost"] is None else a["credit_cost"])
                if a["kind"] == "inmail"
                and a["status"] in ("submitting", "sent", "unknown")
                else 0
                for a in run["actions"]
            )
        return {"rules": self.rules(cid), "runs": runs}

    def status(self, rid, status, detail=""):
        if status not in ("active", "paused", "completed", "cancelled"):
            raise AppError("Неизвестное состояние кампании.")
        run = self.run(rid)
        if run["status"] in ("preview", "cancelled", "completed"):
            raise AppError(
                "План не утверждён или завершён. Подготовьте новый предпросмотр."
            )
        with self.db:
            self.db.execute(
                "UPDATE outreach_runs SET status=?,detail=?,updated=? WHERE id=?",
                (status, detail[:1000], now(), rid),
            )
        return self.run(rid)

    def check_now(self, rid):
        """Advance approved monitoring only; never resume a pause or a draft."""
        run = self.run(rid)
        self.s.ensure_idle(run["campaign_id"])
        if run["status"] != "active":
            raise AppError("Сначала продолжите утверждённую кампанию.")
        with self.db:
            for member in self.members(rid):
                if member["status"] not in TERMINAL:
                    self.db.execute(
                        "UPDATE outreach_members SET next_check=? WHERE id=?",
                        (now(), member["id"]),
                    )
        return run

    def refresh_unattempted(self, cid, candidate_id, observation):
        """Recover read-only detection failures in a paused, approved plan.

        Never clear an uncertain send, an action history, a suppression, or a
        pause. The normal processor re-observes before reserving any action.
        """
        for member in self.s.rows(
            "SELECT m.* FROM outreach_members m JOIN outreach_runs r ON r.id=m.run_id "
            "WHERE r.campaign_id=? AND r.status='paused' AND m.candidate_id=? "
            "AND m.status='needs_review' AND m.invitation_at IS NULL AND m.sent_at IS NULL "
            "AND m.thread_id IS NULL AND m.reply_text='' "
            "AND NOT EXISTS(SELECT 1 FROM outreach_actions a WHERE a.member_id=m.id)",
            (cid, candidate_id),
        ):
            if member["detail"] not in {
                "Не подтверждён владелец открытого профиля.",
                "Доступный способ связи не удалось подтвердить.",
            } or self.blocked(member["url"], member["id"]):
                continue
            action, reason = route(self.run(member["run_id"])["rules"], observation)
            if action not in {"invite", "message", "inmail", "waiting_acceptance"}:
                continue
            self.update_member(
                member["id"],
                status="planned",
                observation=observation,
                relationship=observation.get("relationship", "unknown"),
                checked_at=now(),
                next_check=now(),
                detail="Контакт проверен. Продолжите кампанию для обработки по плану.",
            )

    def update_member(self, mid, **fields):
        allowed = {
            "status",
            "detail",
            "relationship",
            "observation",
            "invitation_at",
            "checked_at",
            "next_check",
            "thread_id",
            "sent_at",
            "reply_text",
        }
        if set(fields) - allowed:
            raise ValueError("Unknown member fields")
        if "observation" in fields:
            fields["observation"] = json.dumps(
                fields["observation"], ensure_ascii=False
            )
        fields["updated"] = now()
        with self.db:
            self.db.execute(
                "UPDATE outreach_members SET "
                + ",".join(k + "=?" for k in fields)
                + " WHERE id=?",
                (*fields.values(), mid),
            )

    def reserve(self, mid, kind, credit_cost=None):
        """Reserve a possibly consumed credit BEFORE calling the browser."""
        if kind not in ACTION_KINDS:
            raise AppError("Неизвестный канал.")
        if credit_cost is not None and (
            type(credit_cost) is not int
            or credit_cost not in (0, 1)
            or kind != "inmail"
        ):
            raise AppError("Неверная стоимость InMail.")
        with self.s.atomic():
            m = self.s.one("SELECT * FROM outreach_members WHERE id=?", (mid,))
            r = self.run(m["run_id"])
            if r["status"] != "active" or self.blocked(m["url"], mid):
                raise AppError("Получатель исключён или план приостановлен.")
            from .invitation_repair import covered_invitation_actions

            covered = covered_invitation_actions(self.s, mid)
            uncertain = self.s.rows(
                "SELECT id,kind,status FROM outreach_actions WHERE member_id=? AND status IN ('unknown','submitting')",
                (mid,),
            )
            if any(
                a["id"] not in covered
                or a["kind"] != "invite"
                or a["status"] != "unknown"
                for a in uncertain
            ):
                raise AppError(
                    "Есть действие с неизвестным результатом. Повтор запрещён."
                )
            if self.s.rows(
                "SELECT 1 FROM outreach_actions WHERE member_id=? AND status='sent' AND (kind IN ('message','inmail') OR kind=?)",
                (mid, kind),
            ):
                raise AppError("Повторное обращение исключено.")
            if kind == "invite" and self.s.rows(
                "SELECT 1 FROM outreach_actions WHERE url=? AND kind='invite' AND status IN ('sent','satisfied')",
                (m["url"],),
            ):
                raise AppError("Приглашение уже отправлено. Ожидаем принятия контакта.")
            rules = r["rules"]
            if (
                kind == "invite"
                and not rules["allow_invites"]
                or kind == "inmail"
                and not rules["allow_inmail"]
            ):
                raise AppError("Этот канал не был утверждён.")
            action = uid()
            self.db.execute(
                "INSERT INTO outreach_actions(id,member_id,account_id,url,kind,credit_cost,status,created,updated) VALUES(?,?,?,?,?,?,'submitting',?,?)",
                (
                    action,
                    mid,
                    r["account_id"],
                    m["url"],
                    kind,
                    credit_cost,
                    now(),
                    now(),
                ),
            )
            return action

    def sender_ids(self, account_id):
        """A verified LinkedIn identity may occupy more than one browser slot."""
        account = self.s.account(account_id)
        if not account["url"]:
            return [account_id]
        return [
            row["id"]
            for row in self.s.rows(
                "SELECT id FROM accounts WHERE url=? AND status!='deleted'",
                (account["url"],),
            )
        ]

    def finish(self, action, status, detail, thread_id=None):
        if status not in ("sent", "unknown", "blocked", "satisfied"):
            raise AppError("Неизвестный результат действия.")
        if (
            status == "satisfied"
            and self.s.one("SELECT kind FROM outreach_actions WHERE id=?", (action,))[
                "kind"
            ]
            != "invite"
        ):
            raise AppError("Подтверждение связи применимо только к приглашению.")
        with self.db:
            self.db.execute(
                "UPDATE outreach_actions SET status=?,detail=?,thread_id=?,updated=? WHERE id=?",
                (status, str(detail)[:1000], thread_id, now(), action),
            )

    def resolve(self, action, confirmed):
        row = self.s.one("SELECT * FROM outreach_actions WHERE id=?", (action,))
        self.s.account(row["account_id"])
        if row["status"] != "unknown" or type(confirmed) is not bool:
            raise AppError("Это действие не требует проверки.")
        self.finish(
            action,
            "sent" if confirmed else "blocked",
            "Результат вручную проверен пользователем в LinkedIn.",
            row["thread_id"],
        )
        fields = {
            "status": "needs_review",
            "detail": "Отсутствие действия подтверждено. Для повторной попытки подготовьте новый план.",
        }
        if confirmed:
            if row["kind"] == "invite":
                fields = {
                    "status": "waiting_acceptance",
                    "invitation_at": row["created"],
                    "next_check": now(),
                    "detail": "Приглашение подтверждено вручную; ожидаем проверки контакта.",
                }
            else:
                fields = {
                    "status": "sent",
                    "sent_at": row["created"],
                    "next_check": now(),
                    "detail": "Отправка сообщения подтверждена вручную в LinkedIn.",
                }
        self.update_member(row["member_id"], **fields)

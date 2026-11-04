"""One explicitly confirmed invitation attempt; historical uncertainty is retained."""

import asyncio
import hashlib
import json
import secrets
from datetime import timedelta

from .outreach import later, now, utc
from .platform_limits import (
    LinkedInAccountRestrictedError,
    LinkedInChallengeError,
    LinkedInLimitError,
)
from .store import AppError, uid


def covered_invitation_actions(store, member_id):
    """Only a confirmed replacement invite can cover its own old invite ledger."""
    covered = {}
    for row in store.rows(
        "SELECT key,value FROM app_settings WHERE key LIKE 'invitation_repair:%'"
    ):
        try:
            link = json.loads(row["value"])
            if link["member_id"] != member_id:
                continue
            new = store.one(
                "SELECT * FROM outreach_actions WHERE id=?", (link["action_id"],)
            )
            if (
                new["member_id"] != member_id
                or new["kind"] != "invite"
                or new["status"] not in {"sent", "satisfied"}
            ):
                continue
            for identity in link["previous_actions"]:
                old = store.one(
                    "SELECT * FROM outreach_actions WHERE id=?", (identity,)
                )
                if (
                    old["member_id"] == member_id
                    and old["kind"] == "invite"
                    and old["status"] == "unknown"
                    and old["url"] == new["url"]
                    and old["account_id"] == new["account_id"]
                ):
                    covered[identity] = new["id"]
        except (ValueError, KeyError, TypeError, AppError):
            continue
    return covered


class InvitationRepair:
    def __init__(self, attention):
        self.attention = attention
        self.rt, self.store = attention.rt, attention.store
        self.proposals = {}

    def context(self, member_id):
        m = self.store.one("SELECT * FROM outreach_members WHERE id=?", (member_id,))
        r = self.store.outreach.run(m["run_id"])
        a = self.store.account(r["account_id"])
        c = self.store.campaign(r["campaign_id"])
        p = self.store.one("SELECT * FROM candidates WHERE id=?", (m["candidate_id"],))
        if (
            a["status"] != "ready"
            or c["status"] == "archived"
            or r["status"] not in {"active", "paused"}
            or not r["rules"]["allow_invites"]
        ):
            raise AppError(
                "Приглашение недоступно: проверьте аккаунт и утверждённый план."
            )
        if (
            p["excluded"]
            or not p["selected"]
            or p["segment"] not in {"open", "neutral"}
            or m["status"] != "needs_review"
        ):
            raise AppError("Состояние получателя изменилось. Проверьте его снова.")
        if c["account_id"] != r["account_id"] or r[
            "rules"
        ] != self.store.outreach.rules(c["id"]):
            raise AppError("Настройки изменились. Подготовьте новый предпросмотр.")
        reason = self.store.outreach.block_reason(m["url"], m["id"])
        if reason:
            raise AppError(reason)
        actions = self.store.rows(
            "SELECT * FROM outreach_actions WHERE member_id=? ORDER BY created",
            (member_id,),
        )
        if any(
            x["account_id"] != r["account_id"] or x["url"] != m["url"] for x in actions
        ):
            raise AppError(
                "История получателя не соответствует отправителю. Проверьте её вручную."
            )
        if not actions or any(
            x["status"] == "submitting"
            or (
                x["status"] in {"sent", "satisfied", "unknown"}
                and x["kind"] != "invite"
            )
            for x in actions
        ):
            raise AppError(
                "Есть другое неподтверждённое или выполненное действие. Проверьте историю."
            )
        if self.store.rows(
            "SELECT 1 FROM outreach_actions WHERE url=? AND kind='invite' AND status IN ('sent','satisfied','submitting')",
            (m["url"],),
        ):
            raise AppError("Есть уже подтверждённое приглашение. Повтор не требуется.")
        previous = [
            x["id"]
            for x in actions
            if x["kind"] == "invite" and x["status"] == "unknown"
        ]
        if not previous and not any(
            x["kind"] == "invite" and x["status"] == "blocked" for x in actions
        ):
            raise AppError("Нет попытки приглашения, которую требуется исправить.")
        fingerprint = hashlib.sha256(
            json.dumps(
                {
                    "member": m,
                    "account": [a["id"], a["url"], a["status"]],
                    "run": [
                        r["id"],
                        r["digest"],
                        r["status"],
                        r["rules"],
                    ],
                    "campaign": [c["id"], c["revision"], c["account_id"]],
                    "actions": actions,
                },
                sort_keys=True,
                ensure_ascii=False,
            ).encode()
        ).hexdigest()
        return m, r, a, previous, fingerprint

    def offer(self, identity, member_id, observation):
        self.proposals.pop(identity, None)
        if (
            observation.get("identity_verified") is not True
            or observation.get("relationship") != "not_connected"
            or observation.get("can_invite") is not True
        ):
            return None
        try:
            m, r, a, old, fingerprint = self.context(member_id)
        except AppError:
            return None
        proposal = dict(
            digest=secrets.token_hex(24),
            member_id=m["id"],
            name=m["name"] or m["url"],
            url=m["url"],
            note=m["invitation"],
            account_id=a["id"],
            account_label=a["label"],
            expires_at=(utc() + timedelta(minutes=10)).isoformat(),
        )
        self.proposals[identity] = {
            "public": proposal,
            "fingerprint": fingerprint,
            "previous_actions": old,
        }
        return proposal

    def public(self, identity):
        proposal = self.proposals.get(identity)
        if not proposal:
            return None
        try:
            valid = (
                utc() < utc(proposal["public"]["expires_at"])
                and self.context(proposal["public"]["member_id"])[-1]
                == proposal["fingerprint"]
            )
        except AppError:
            valid = False
        if not valid:
            self.proposals.pop(identity, None)
            return None
        return proposal["public"]

    def start(self, identity, digest, confirm):
        public = self.public(identity)
        if (
            confirm is not True
            or not public
            or not isinstance(digest, str)
            or not secrets.compare_digest(public["digest"], digest)
        ):
            raise AppError(
                "Подтверждение устарело. Проверьте профиль ещё раз и подтвердите одно приглашение."
            )
        proposal = self.proposals.pop(identity)
        member = self.store.one(
            "SELECT run_id FROM outreach_members WHERE id=?", (public["member_id"],)
        )
        campaign_id = self.store.outreach.run(member["run_id"])["campaign_id"]
        proposal["pause_generation"] = getattr(self.rt, "pause_generations", {}).get(
            campaign_id, 0
        )
        self.attention.states[identity] = {"repairing": True, "repair_error": ""}
        self.rt.spawn("repair:" + public["member_id"], self.send(identity, proposal))
        return {"started": True}

    def check_pause_generation(self, proposal, campaign_id):
        if getattr(self.rt, "pause_generations", {}).get(
            campaign_id, 0
        ) != proposal.get("pause_generation", 0):
            raise AppError(
                "Отправка отменена по запросу паузы. Приглашение не отправлялось."
            )

    def update_result_member(self, member_id, **fields):
        current = self.store.one(
            "SELECT * FROM outreach_members WHERE id=?", (member_id,)
        )
        run = self.store.outreach.run(current["run_id"])
        person = self.store.one(
            "SELECT excluded FROM candidates WHERE id=?", (current["candidate_id"],)
        )
        if (
            current["status"] == "excluded"
            or person["excluded"]
            or self.store.rows(
                "SELECT 1 FROM suppression WHERE url=?", (current["url"],)
            )
            or run["status"] in {"cancelled", "completed"}
        ):
            fields["status"] = "excluded"
            fields["detail"] = (
                "Результат попытки сохранён в истории. Дальнейшая обработка остановлена пользователем."
            )
        self.store.outreach.update_member(member_id, **fields)

    async def send(self, identity, proposal):
        public = proposal["public"]
        action_id = None
        cid = None
        try:
            async with self.rt.browser_lock:
                m, r, a, old, fingerprint = self.context(public["member_id"])
                cid = r["campaign_id"]
                self.check_pause_generation(proposal, cid)
                task = asyncio.current_task()
                self.rt.campaign_operations[cid] = task
                self.rt.active_campaign_tasks.add(task)
                self.store.progress(
                    cid, "automating", "Отправляем одно подтверждённое приглашение…"
                )
                if (
                    utc() >= utc(public["expires_at"])
                    or fingerprint != proposal["fingerprint"]
                ):
                    raise AppError(
                        "Состояние изменилось во время ожидания. Проверьте профиль ещё раз."
                    )
                await self.rt.verify(a["id"])
                self.check_pause_generation(proposal, cid)
                observation = await self.rt.worker(a["id"]).call(
                    "observe",
                    {
                        "url": m["url"],
                        "relationship_only": True,
                        "check_history": False,
                    },
                )
                self.check_pause_generation(proposal, cid)
                if self.context(m["id"])[-1] != fingerprint:
                    raise AppError(
                        "Получатель или план изменился. Приглашение не отправлялось."
                    )
                if observation.get("identity_verified") is not True:
                    raise AppError(
                        "LinkedIn не подтвердил профиль. Приглашение не отправлялось."
                    )
                if observation.get("relationship") in {"connected", "pending"}:
                    old_action = (
                        self.store.one(
                            "SELECT * FROM outreach_actions WHERE id=?", (old[-1],)
                        )
                        if old
                        else None
                    )
                    if old_action and len(old) > 1:
                        with self.store.db:
                            self.store.db.execute(
                                "INSERT OR REPLACE INTO app_settings(key,value) VALUES(?,?)",
                                (
                                    "invitation_repair:" + old_action["id"],
                                    json.dumps(
                                        {
                                            "action_id": old_action["id"],
                                            "member_id": m["id"],
                                            "previous_actions": old[:-1],
                                            "connection_verified_at": now(),
                                        }
                                    ),
                                ),
                            )
                    self.attention.reconcile_contact(m, r, old_action, observation)
                    return
                if (
                    observation.get("relationship") != "not_connected"
                    or observation.get("can_invite") is not True
                ):
                    raise AppError(
                        "LinkedIn сейчас не предлагает приглашение. Ничего не отправлялось."
                    )
                with self.store.atomic():
                    self.check_pause_generation(proposal, cid)
                    if self.context(m["id"])[-1] != fingerprint:
                        raise AppError(
                            "Подтверждение устарело. Ничего не отправлялось."
                        )
                    action_id = uid()
                    self.store.db.execute(
                        "INSERT INTO outreach_actions(id,member_id,account_id,url,kind,status,created,updated) VALUES(?,?,?,?,'invite','submitting',?,?)",
                        (action_id, m["id"], a["id"], m["url"], now(), now()),
                    )
                    link = {
                        "action_id": action_id,
                        "member_id": m["id"],
                        "previous_actions": old,
                        "authorized_at": now(),
                        "recipient": m["url"],
                        "note": m["invitation"],
                    }
                    self.store.db.execute(
                        "INSERT INTO app_settings(key,value) VALUES(?,?)",
                        (
                            "invitation_repair:" + action_id,
                            json.dumps(link, ensure_ascii=False),
                        ),
                    )
                try:
                    result = await self.rt.worker(a["id"]).call(
                        "invite", {"url": m["url"], "note": m["invitation"]}
                    )
                except BaseException:
                    self.store.outreach.finish(
                        action_id,
                        "unknown",
                        "Ответ новой подтверждённой попытки потерян. Повтор заблокирован.",
                    )
                    self.update_result_member(
                        m["id"],
                        status="needs_review",
                        detail="Не удалось подтвердить новое приглашение. Проверьте результат.",
                    )
                    try:
                        await self.rt.worker(a["id"]).stop()
                    except Exception:
                        self.rt.pause_for_challenge(
                            a["id"],
                            "Не удалось закрыть браузер после потери ответа. Проверьте вход.",
                        )
                    self.rt.workers.pop(a["id"], None)
                    raise
                if result.get("invited") is True or (
                    result.get("contact_satisfied") is True
                    and result.get("relationship") in {"connected", "pending"}
                ):
                    satisfied = result.get("contact_satisfied") is True and result.get(
                        "relationship"
                    ) in {"connected", "pending"}
                    relation = result.get("relationship") if satisfied else "pending"
                    self.store.outreach.finish(
                        action_id,
                        "satisfied" if satisfied else "sent",
                        result.get("message") or "Новое приглашение подтверждено.",
                    )
                    self.update_result_member(
                        m["id"],
                        status="planned"
                        if relation == "connected"
                        else "waiting_acceptance",
                        relationship=relation,
                        invitation_at=m["invitation_at"]
                        if relation == "connected"
                        else now(),
                        checked_at=now(),
                        next_check=later(hours=r["rules"]["check_hours"]),
                        detail="Контакт уже существует. Дальше действует утверждённый план."
                        if relation == "connected"
                        else "Приглашение подтверждено; ожидаем принятия.",
                    )
                else:
                    self.store.outreach.finish(
                        action_id,
                        "blocked" if result.get("retry_safe") is True else "unknown",
                        result.get("message") or "Результат не подтверждён.",
                    )
                    self.update_result_member(
                        m["id"],
                        status="needs_review",
                        detail=result.get("message")
                        or "Новую попытку не удалось подтвердить.",
                    )
                if result.get("account_restricted"):
                    raise AppError(self.rt.restrict_account(a["id"]))
                if result.get("auth_required"):
                    self.rt.pause_for_challenge(
                        a["id"], result.get("message") or "Проверьте вход LinkedIn."
                    )
                    raise LinkedInChallengeError(
                        result.get("message") or "Проверьте вход LinkedIn."
                    )
                if result.get("platform_limited"):
                    self.rt.pause_sender(
                        a["id"], result.get("message") or "LinkedIn сообщил о лимите."
                    )
                    raise LinkedInLimitError(
                        result.get("message") or "LinkedIn сообщил о лимите."
                    )
        except Exception as exc:
            if cid:
                if isinstance(exc, LinkedInAccountRestrictedError):
                    self.rt.restrict_account(a["id"])
                elif isinstance(exc, LinkedInChallengeError):
                    self.rt.pause_for_challenge(a["id"], self.rt.friendly(exc))
                elif isinstance(exc, LinkedInLimitError):
                    self.rt.pause_sender(a["id"], self.rt.friendly(exc))
                elif self.store.account(a["id"])["status"] != "ready":
                    self.rt.pause_sender(a["id"], self.rt.friendly(exc))
            self.attention.states[identity] = {
                "repairing": False,
                "repair_error": self.rt.friendly(exc),
            }
        finally:
            self.attention.states.setdefault(identity, {})["repairing"] = False
            if cid:
                task = asyncio.current_task()
                self.rt.active_campaign_tasks.discard(task)
                if self.rt.campaign_operations.get(cid) is task:
                    self.rt.campaign_operations.pop(cid, None)
                run = self.store.outreach.run(r["id"])
                self.store.progress(
                    cid,
                    "waiting" if run["status"] == "active" else "paused",
                    self.attention.states[identity].get("repair_error")
                    or "Состояние получателя обновлено. Кампания сохранена.",
                )

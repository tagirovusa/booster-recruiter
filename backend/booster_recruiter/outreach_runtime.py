"""Runs only frozen, approved plans; all browser access uses Runtime's lock."""

import asyncio
from datetime import timedelta

from .outreach import TERMINAL, later, now, route, utc, within_hours
from .platform_limits import LinkedInLimitError
from .store import AppError


class OutreachRuntime:
    def __init__(self, runtime):
        self.rt = runtime
        self.store = runtime.store
        self.repo = self.store.outreach
        self.scheduler = None

    def start(self):
        if not self.scheduler or self.scheduler.done():
            self.scheduler = asyncio.create_task(self.schedule())

    async def stop(self):
        if self.scheduler:
            self.scheduler.cancel()
            await asyncio.gather(self.scheduler, return_exceptions=True)
            self.scheduler = None

    async def schedule(self):
        while True:
            try:
                self.tick()
            except Exception as exc:
                self.store.event("scheduler_error", self.rt.friendly(exc))
            await asyncio.sleep(30)

    def tick(self):
        if self.rt.browser_lock.locked() or any(
            not t.done() for t in self.rt.jobs.values()
        ):
            return
        for row in self.store.rows(
            "SELECT id FROM outreach_runs WHERE status='active' ORDER BY updated"
        ):
            run = self.repo.run(row["id"])
            if self.store.account(run["account_id"])["status"] != "ready":
                continue
            members = self.repo.members(run["id"])
            due = [
                m
                for m in members
                if m["status"] not in TERMINAL and m["next_check"] <= now()
            ]
            if due and within_hours(run["rules"]):
                self.rt.start_campaign(
                    run["campaign_id"], self.process(run["id"]), "automating"
                )
                break
            if not any(m["status"] not in TERMINAL for m in members):
                needs_review = any(m["status"] == "needs_review" for m in members)
                self.repo.status(
                    run["id"],
                    "paused" if needs_review else "completed",
                    "Проверьте спорные результаты в истории."
                    if needs_review
                    else "Все получатели обработаны.",
                )

    async def check(self, cid):
        """Explicit read-only refresh, including people not approved for outreach."""
        c = self.store.campaign(cid)
        try:
            async with self.rt.campaign_browser(
                cid, "checking", "Проверяем аккаунт перед проверкой контактов…"
            ):
                if cid in self.rt.pause_flags:
                    self.store.progress(
                        cid, "paused", "Проверка контактов приостановлена."
                    )
                    return
                await self.rt.verify(c["account_id"])
                candidates = self.store.detail(cid)["candidates"]
                for index, p in enumerate(candidates, 1):
                    if cid in self.rt.pause_flags:
                        break
                    self.store.progress(
                        cid,
                        "checking",
                        f"Проверяем контакт {index} из {len(candidates)}…",
                    )
                    observation = await self.rt.worker(c["account_id"]).call(
                        "observe", {"url": p["url"], "check_history": True}
                    )
                    import json

                    data = p["data"]
                    data["contact"] = observation | {"checked_at": now()}
                    with self.store.db:
                        self.store.db.execute(
                            "UPDATE candidates SET data=? WHERE id=?",
                            (json.dumps(data, ensure_ascii=False), p["id"]),
                        )
                    self.repo.refresh_unattempted(cid, p["id"], observation)
            self.store.progress(
                cid,
                "paused" if cid in self.rt.pause_flags else "ready",
                "Проверка контактов приостановлена."
                if cid in self.rt.pause_flags
                else "Состояние контактов проверено. Приглашения и сообщения не отправлялись.",
            )
        except Exception as exc:
            self.store.progress(cid, "paused", self.rt.friendly(exc))

    async def process(self, rid):
        run = self.repo.run(rid)
        cid, aid, rules = run["campaign_id"], run["account_id"], run["rules"]
        if run["status"] == "paused":
            self.store.progress(cid, "paused", "Кампания приостановлена.")
            return
        if run["status"] != "active":
            raise AppError("План не утверждён или приостановлен.")
        try:
            async with self.rt.campaign_browser(
                cid, "automating", "Проверяем аккаунт и утверждённый план…"
            ):
                if (
                    cid in self.rt.pause_flags
                    or self.repo.run(rid)["status"] != "active"
                ):
                    self.store.progress(cid, "paused", "Кампания приостановлена.")
                    return
                if not within_hours(rules):
                    self.store.progress(
                        cid,
                        "waiting",
                        "Ожидаем рабочего времени по расписанию кампании.",
                    )
                    return
                await self.rt.verify(aid)
                for member in self.repo.members(rid):
                    if (
                        cid in self.rt.pause_flags
                        or self.repo.run(rid)["status"] != "active"
                        or not within_hours(rules)
                    ):
                        break
                    if member["status"] in TERMINAL or member["next_check"] > now():
                        continue
                    if self.repo.blocked(member["url"], member["id"]):
                        self.repo.update_member(
                            member["id"],
                            status="excluded",
                            detail="Получатель исключён или уже обработан в другой кампании.",
                        )
                        continue
                    if utc() >= utc(member["sent_at"] or run["created"]) + timedelta(
                        days=rules["monitor_days"]
                    ):
                        self.repo.update_member(
                            member["id"],
                            status="finished",
                            detail="Период наблюдения завершён. История сохранена.",
                        )
                        continue
                    self.store.progress(
                        cid,
                        "automating",
                        f"Проверяем: {member['name'] or member['url']}",
                    )
                    if member["sent_at"]:
                        sent_actions = self.store.rows(
                            "SELECT kind FROM outreach_actions WHERE member_id=? AND status='sent' AND kind IN ('message','inmail') ORDER BY created DESC LIMIT 1",
                            (member["id"],),
                        )
                        recruiter_context = (
                            run["context"]
                            if (
                                run["context"]
                                and sent_actions
                                and sent_actions[0]["kind"] == "inmail"
                            )
                            else None
                        )
                        result = await self.rt.worker(aid).call(
                            "check_reply",
                            {
                                "url": member["url"],
                                "thread_id": member["thread_id"],
                                "since": member["sent_at"],
                                "recruiter": recruiter_context,
                                "message": member["inmail_message"]
                                if recruiter_context
                                else "",
                                "subject": member["subject"]
                                if recruiter_context
                                else "",
                            },
                        )
                        self.repo.update_member(
                            member["id"],
                            status="replied" if result.get("has_reply") else "sent",
                            reply_text=result.get("reply_text", ""),
                            thread_id=result.get("thread_id", member["thread_id"]),
                            detail=result.get("detail", "Ответ пока не обнаружен."),
                            checked_at=now(),
                            next_check=later(hours=rules["check_hours"]),
                        )
                        continue
                    observation = await self.rt.worker(aid).call(
                        "observe",
                        {
                            "url": member["url"],
                            "check_history": True,
                            "recruiter": run["context"] or None,
                        },
                    )
                    # Observed pending invitations made outside the app start their wait now.
                    invited = member["invitation_at"]
                    if observation.get("relationship") == "pending" and not invited:
                        invited = now()
                    self.repo.update_member(
                        member["id"],
                        observation=observation,
                        relationship=observation.get("relationship", "unknown"),
                        checked_at=now(),
                        invitation_at=invited,
                    )
                    action, reason = route(rules, observation, invited)
                    if action not in ("invite", "message", "inmail"):
                        self.repo.update_member(
                            member["id"],
                            status=action,
                            reply_text=observation.get("reply_text", ""),
                            detail=reason,
                            next_check=later(hours=rules["check_hours"]),
                        )
                        continue
                    if (
                        action == "inmail"
                        and not observation.get("inmail_free")
                        and (
                            type(observation.get("credits")) is not int
                            or observation["credits"] < 1
                        )
                    ):
                        self.repo.update_member(
                            member["id"],
                            status="waiting_credits",
                            detail="Нет подтверждённых доступных InMail-кредитов. Проверим позже.",
                            next_check=later(hours=rules["check_hours"]),
                        )
                        continue
                    # Re-read approval/suppression after the asynchronous observation.
                    if (
                        cid in self.rt.pause_flags
                        or self.repo.run(rid)["status"] != "active"
                        or not within_hours(rules)
                    ):
                        break
                    try:
                        action_id = self.repo.reserve(
                            member["id"],
                            action,
                            credit_cost=(0 if observation.get("inmail_free") else 1)
                            if action == "inmail"
                            else None,
                        )
                    except AppError as exc:
                        self.repo.update_member(
                            member["id"],
                            status="needs_review",
                            detail=str(exc),
                            next_check=later(hours=rules["check_hours"]),
                        )
                        continue
                    params = {"url": member["url"]}
                    if action == "invite":
                        params["note"] = member["invitation"]
                    else:
                        params["message"] = (
                            member["inmail_message"]
                            if action == "inmail"
                            else member["message"]
                        )
                    if action == "inmail":
                        params["subject"] = member["subject"]
                        if run["context"]:
                            params["recruiter"] = run["context"]
                            params["credit_cost"] = (
                                0 if observation.get("inmail_free") else 1
                            )
                    try:
                        result = await self.rt.worker(aid).call(
                            {
                                "invite": "invite",
                                "message": "send_free",
                                "inmail": "send_inmail",
                            }[action],
                            params,
                        )
                    except BaseException:
                        self.repo.finish(
                            action_id,
                            "unknown",
                            "Ответ браузера потерян. Повторное действие заблокировано.",
                        )
                        self.repo.update_member(
                            member["id"],
                            status="needs_review",
                            detail="Проверьте результат действия в LinkedIn.",
                        )
                        raise
                    confirmed = (
                        result.get("invited") is True
                        if action == "invite"
                        else result.get("sent") is True
                    )
                    if confirmed:
                        self.repo.finish(
                            action_id,
                            "sent",
                            result.get("message", "Действие подтверждено в LinkedIn."),
                            result.get("thread_id"),
                        )
                        fields = (
                            {"status": "waiting_acceptance", "invitation_at": now()}
                            if action == "invite"
                            else {
                                "status": "sent",
                                "sent_at": now(),
                                "thread_id": result.get("thread_id"),
                            }
                        )
                        self.repo.update_member(
                            member["id"],
                            **fields,
                            detail="Приглашение отправлено; ожидаем принятия."
                            if action == "invite"
                            else "Появление сообщения подтверждено в LinkedIn.",
                            next_check=later(hours=rules["check_hours"]),
                        )
                    elif result.get("retry_safe") is True:
                        self.repo.finish(
                            action_id,
                            "blocked",
                            result.get("message", "Действие не выполнено."),
                        )
                        self.repo.update_member(
                            member["id"],
                            status="needs_review",
                            detail=result.get(
                                "message", "Проверьте доступность действия."
                            ),
                        )
                    else:
                        self.repo.finish(
                            action_id,
                            "unknown",
                            result.get("message", "Результат не подтверждён."),
                        )
                        self.repo.update_member(
                            member["id"],
                            status="needs_review",
                            detail="Результат не подтверждён. Повтор для этого человека заблокирован.",
                        )
                    if result.get("account_restricted"):
                        raise AppError(self.rt.restrict_account(aid))
                    if result.get("platform_limited"):
                        raise LinkedInLimitError(
                            result.get("message")
                            or "LinkedIn сообщил о лимите отправки."
                        )
                active = (
                    self.repo.run(rid)["status"] == "active"
                    and cid not in self.rt.pause_flags
                )
                self.store.progress(
                    cid,
                    "waiting" if active else "paused",
                    "Очередь сохранена. Следующие проверки выполнятся по расписанию."
                    if active
                    else "Кампания приостановлена. Очередь и результаты сохранены.",
                )
        except Exception as exc:
            if isinstance(exc, LinkedInLimitError):
                self.rt.pause_sender(aid, self.rt.friendly(exc))
            for row in self.store.rows(
                "SELECT id FROM outreach_runs WHERE account_id=? AND status='active'",
                (aid,),
            ):
                self.repo.status(row["id"], "paused", self.rt.friendly(exc))
            self.store.progress(cid, "paused", self.rt.friendly(exc))

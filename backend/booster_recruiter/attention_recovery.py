"""Explicit read-only reconciliation. This module never dispatches outreach."""

from .outreach import now
from .store import AppError


class AttentionRecovery:
    def __init__(self, runtime):
        self.rt = runtime
        self.store = runtime.store
        self.states = {}

    def capability(self, item):
        if item["id"].startswith("delivery:"):
            row = self.store.one(
                "SELECT thread_id FROM deliveries WHERE id=?", (item["action_id"],)
            )
            unsupported = (row["thread_id"] or "").startswith("recruiter:")
        else:
            member = self.store.one(
                "SELECT * FROM outreach_members WHERE id=?", (item["member_id"],)
            )
            actions = self.store.rows(
                "SELECT kind FROM outreach_actions WHERE member_id=? AND status IN ('unknown','submitting')",
                (member["id"],),
            )
            run = self.store.outreach.run(member["run_id"])
            unsupported = any(
                a["kind"] != "invite"
                and (run["context"] or (a["kind"] == "inmail" and member["subject"]))
                for a in actions
            )
        return not bool(unsupported), (
            "Для этой старой отправки InMail не сохранено достаточно данных для автоматического подтверждения. Откройте переписку и укажите результат вручную."
            if unsupported
            else ""
        )

    def decorate(self, summary):
        for item in summary["items"]:
            if item["kind"] == "review":
                available, reason = self.capability(item)
                item.update(
                    can_recheck=available,
                    recheck_unavailable_reason=reason,
                    recheck_label="Проверить автоматически",
                    **self.states.get(item["id"], {}),
                )
        return summary

    def item(self, identity):
        item = next(
            (
                i
                for i in self.store.workspace.summary()["items"]
                if i["id"] == identity and i["kind"] == "review"
            ),
            None,
        )
        if item is None:
            raise AppError(
                "Этот результат уже проверен или больше не требует внимания."
            )
        return item

    def start(self, identity):
        item = self.item(identity)
        available, reason = self.capability(item)
        if not available:
            raise AppError(reason)
        if self.rt.browser_lock.locked() or any(
            not task.done() for task in self.rt.jobs.values()
        ):
            raise AppError(
                "Браузер занят. Дождитесь текущего действия или приостановите кампанию."
            )
        self.store.ensure_idle(item["campaign_id"])
        # A terminal review member can become routable after this check. Pause
        # its existing approval so the scheduler cannot turn a read into a send.
        for run in self.store.outreach.detail(item["campaign_id"])["runs"]:
            if run["status"] == "active":
                self.store.outreach.status(
                    run["id"],
                    "paused",
                    "Проверка результата без отправки. Продолжите кампанию вручную.",
                )
        self.rt.pause_flags.add(item["campaign_id"])
        self.store.progress(
            item["campaign_id"],
            "paused",
            "Проверяем результат без отправки; кампания остаётся на паузе.",
        )
        self.states[identity] = {"checking": True, "check_error": ""}
        self.rt.spawn("attention:" + item["campaign_id"], self.check(item))
        return {"started": True}

    async def check(self, item):
        identity, cid, aid = item["id"], item["campaign_id"], item["account_id"]
        previous = self.store.campaign(cid)["status"]
        detail = "Автоматическая проверка завершена. Ничего не отправлялось."
        failed = False
        try:
            async with self.rt.campaign_browser(
                cid, "checking", "Проверяем результат в LinkedIn без отправки…"
            ):
                await self.rt.verify(aid)
                if identity.startswith("delivery:"):
                    row = self.store.one(
                        "SELECT * FROM deliveries WHERE id=?", (item["action_id"],)
                    )
                    result = await self.rt.worker(aid).call(
                        "verify_delivery",
                        {
                            "url": row["url"],
                            "message": row["message"],
                            # Legacy rows have no preserved dispatch baseline. Their last
                            # action update is a conservative boundary, never preview time.
                            "since": row["updated"],
                            "thread_id": row["thread_id"],
                        },
                    )
                    current = self.store.one(
                        "SELECT status,updated FROM deliveries WHERE id=?", (row["id"],)
                    )
                    if (
                        current["status"] != "unknown"
                        or current["updated"] != row["updated"]
                    ):
                        raise AppError(
                            "Результат уже изменён. Обновите историю перед следующей проверкой."
                        )
                    if result.get("confirmed") is True:
                        self.store.finish(
                            row["id"],
                            "sent",
                            "Точное исходящее сообщение подтверждено автоматической проверкой LinkedIn.",
                            result.get("thread_id"),
                        )
                    else:
                        detail = (
                            result.get("detail")
                            or "Пока недостаточно данных для подтверждения отправки. Повтор не выполнялся."
                        )
                        with self.store.db:
                            self.store.db.execute(
                                "UPDATE deliveries SET detail=? WHERE id=?",
                                (detail, row["id"]),
                            )
                else:
                    member = self.store.one(
                        "SELECT * FROM outreach_members WHERE id=?",
                        (item["member_id"],),
                    )
                    run = self.store.outreach.run(member["run_id"])
                    actions = self.store.rows(
                        "SELECT * FROM outreach_actions WHERE member_id=? AND status IN ('unknown','submitting') ORDER BY created DESC",
                        (member["id"],),
                    )
                    if len(actions) > 1:
                        raise AppError(
                            "Есть несколько неоднозначных действий. Проверьте их в истории отдельно."
                        )
                    action = actions[0] if actions else None
                    if action and action["kind"] != "invite":
                        result = await self.rt.worker(aid).call(
                            "verify_delivery",
                            {
                                "url": member["url"],
                                "message": member["inmail_message"]
                                if action["kind"] == "inmail"
                                else member["message"],
                                "subject": member["subject"]
                                if action["kind"] == "inmail"
                                else "",
                                "since": action["created"],
                                "thread_id": action["thread_id"] or member["thread_id"],
                                "recruiter": run["context"]
                                if action["kind"] == "inmail"
                                else None,
                            },
                        )
                        current = self.store.one(
                            "SELECT status,updated FROM outreach_actions WHERE id=?",
                            (action["id"],),
                        )
                        current_member = self.store.one(
                            "SELECT updated FROM outreach_members WHERE id=?",
                            (member["id"],),
                        )
                        if (
                            current["status"] not in {"unknown", "submitting"}
                            or current["updated"] != action["updated"]
                            or current_member["updated"] != member["updated"]
                        ):
                            raise AppError(
                                "Результат уже изменён. Обновите историю перед следующей проверкой."
                            )
                        if result.get("confirmed") is True:
                            self.store.outreach.finish(
                                action["id"],
                                "sent",
                                "Точное исходящее сообщение подтверждено автоматической проверкой LinkedIn.",
                                result.get("thread_id"),
                            )
                            self.store.outreach.update_member(
                                member["id"],
                                status="sent",
                                sent_at=action["created"],
                                checked_at=now(),
                                thread_id=result.get("thread_id"),
                                detail="Отправка подтверждена автоматически. Повтор не требуется.",
                            )
                        else:
                            detail = (
                                result.get("detail")
                                or "Пока недостаточно данных для подтверждения отправки. Повтор не выполнялся."
                            )
                            self.store.outreach.update_member(
                                member["id"], detail=detail, checked_at=now()
                            )
                    else:
                        result = await self.rt.worker(aid).call(
                            "observe",
                            {
                                "url": member["url"],
                                "check_history": not bool(action),
                                "relationship_only": bool(action),
                                "recruiter": None if action else run["context"] or None,
                            },
                        )
                        detail = self.reconcile_contact(member, run, action, result)
        except Exception as exc:
            failed = True
            detail = self.rt.friendly(exc)
            self.states[identity] = {"checking": False, "check_error": detail}
        finally:
            self.states.setdefault(identity, {})["checking"] = False
            if not failed:
                self.states[identity]["check_error"] = ""
            try:
                self.store.progress(
                    cid,
                    "paused" if failed or cid in self.rt.pause_flags else previous,
                    detail,
                )
            except AppError:
                pass

    def reconcile_contact(self, member, run, action, observation):
        repo = self.store.outreach
        current = self.store.one(
            "SELECT updated FROM outreach_members WHERE id=?", (member["id"],)
        )
        if current["updated"] != member["updated"]:
            raise AppError(
                "Результат уже изменён. Обновите историю перед следующей проверкой."
            )
        run = repo.run(member["run_id"])
        if observation.get("identity_verified") is not True:
            detail = "Автоматическая проверка не подтвердила профиль. Проверьте вход или откройте профиль вручную."
            repo.update_member(member["id"], detail=detail, checked_at=now())
            return detail
        relation = observation.get("relationship", "unknown")
        fields = {
            "observation": observation,
            "relationship": relation,
            "checked_at": now(),
        }
        if (
            not action
            and observation.get("history_verified") is True
            and observation.get("has_reply")
        ):
            fields.update(
                status="replied",
                reply_text=observation.get("reply_text", ""),
                detail="Ответ найден в LinkedIn. Продолжите разговор вручную.",
            )
        elif (
            not action
            and observation.get("history_verified") is True
            and observation.get("has_outgoing")
        ):
            fields.update(
                status="excluded",
                detail="В LinkedIn уже начата переписка. Новое обращение не требуется.",
            )
        elif relation in {"connected", "pending"}:
            if action:
                repo.finish(
                    action["id"],
                    "satisfied",
                    "Связь уже существует."
                    if relation == "connected"
                    else "Приглашение уже ожидает принятия. Повтор не требуется.",
                )
            if run["status"] in {"cancelled", "completed"} or repo.blocked(
                member["url"], member["id"]
            ):
                fields.update(
                    status="excluded",
                    detail="Контакт подтверждён. Этот план завершён или общение уже учтено в другом плане.",
                )
            elif relation == "connected":
                fields.update(
                    status="planned",
                    next_check=now(),
                    detail="Контакт уже существует. При продолжении кампании проверим доступное сообщение; сейчас ничего не отправлялось.",
                )
            else:
                fields.update(
                    status="waiting_acceptance",
                    invitation_at=member["invitation_at"] or now(),
                    next_check=now(),
                    detail="Приглашение уже ожидает принятия. Повторно не отправляли.",
                )
        elif (
            not action
            and observation.get("history_verified") is True
            and relation == "not_connected"
        ):
            fields.update(
                status="planned",
                next_check=now(),
                detail="Контакт проверен. Для отправки продолжите утверждённую кампанию вручную.",
            )
        else:
            fields["detail"] = (
                "Пока недостаточно данных для подтверждения результата. Повтор не выполнялся; можно проверить ещё раз позже или открыть LinkedIn."
            )
        repo.update_member(member["id"], **fields)
        return fields["detail"]

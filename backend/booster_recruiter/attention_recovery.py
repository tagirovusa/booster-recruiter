"""Explicit read-only reconciliation. This module never dispatches outreach."""

from .outreach import now
from .platform_limits import (
    LinkedInAccountRestrictedError,
    LinkedInChallengeError,
    LinkedInLimitError,
)
from .store import AppError

CHECK_DONE = "Автоматическая проверка завершена. Ничего не отправлялось."
RESULT_CHANGED = "Результат уже изменён. Обновите историю перед следующей проверкой."
DELIVERY_CONFIRMED = (
    "Точное исходящее сообщение подтверждено автоматической проверкой LinkedIn."
)
DELIVERY_UNCONFIRMED = (
    "Пока недостаточно данных для подтверждения отправки. Повтор не выполнялся."
)
RECHECK_UNSUPPORTED = "Для этой старой отправки InMail не сохранено достаточно данных для автоматического подтверждения. Откройте переписку и укажите результат вручную."
CONTACT_RELATIONS = {"connected", "pending"}


def pause_after_platform_error(rt, aid, exc, detail):
    """Restrict or pause the sender after a platform failure.

    Returns False when the failure did not affect the account.
    """
    if isinstance(exc, LinkedInAccountRestrictedError):
        rt.restrict_account(aid)
    elif isinstance(exc, LinkedInChallengeError):
        rt.pause_for_challenge(aid, detail)
    elif (
        isinstance(exc, LinkedInLimitError)
        or rt.store.account(aid)["status"] != "ready"
    ):
        rt.pause_sender(aid, detail)
    else:
        return False
    return True


class AttentionRecovery:
    def __init__(self, runtime):
        self.rt = runtime
        self.store = runtime.store
        self.states = {}
        from .invitation_repair import InvitationRepair

        self.repairs = InvitationRepair(self)

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
        if unsupported:
            return False, RECHECK_UNSUPPORTED
        return True, ""

    def decorate(self, summary):
        for item in summary["items"]:
            if item["kind"] == "review":
                available, reason = self.capability(item)
                item.update(
                    repair=self.repairs.public(item["id"]),
                    can_recheck=available,
                    recheck_unavailable_reason=reason,
                    recheck_label="Уточнить статус",
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
        self.states[identity] = {"checking": True, "check_error": ""}
        self.rt.spawn("attention:" + item["campaign_id"], self.check(item))
        return {"started": True}

    async def check(self, item):
        identity, cid, aid = item["id"], item["campaign_id"], item["account_id"]
        previous = self.store.campaign(cid)["status"]
        detail = CHECK_DONE
        failed = False
        try:
            async with self.rt.campaign_browser(
                cid, "checking", "Проверяем результат в LinkedIn без отправки…"
            ):
                await self.rt.verify(aid)
                if identity.startswith("delivery:"):
                    detail = await self._check_delivery(item, aid)
                else:
                    detail = await self._check_member(item, aid)
        except Exception as exc:
            failed = True
            detail = self.rt.friendly(exc)
            if not pause_after_platform_error(self.rt, aid, exc, detail):
                await self._close_worker(aid)
            self.states[identity] = {"checking": False, "check_error": detail}
        finally:
            self.states.setdefault(identity, {})["checking"] = False
            if not failed:
                self.states[identity]["check_error"] = ""
            if cid in self.rt.pause_flags:
                status = "paused"
            elif failed and previous in {"waiting", "ready"}:
                status = "waiting"
            else:
                status = previous
            try:
                self.store.progress(cid, status, detail)
            except AppError:
                pass

    async def _close_worker(self, aid):
        worker = self.rt.workers.get(aid)
        if not worker:
            return
        try:
            await worker.stop()
        except Exception:
            self.rt.pause_for_challenge(
                aid, "Браузер не закрылся после ошибки. Проверьте вход."
            )
        self.rt.workers.pop(aid, None)

    async def _check_delivery(self, item, aid):
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
        if current["status"] != "unknown" or current["updated"] != row["updated"]:
            raise AppError(RESULT_CHANGED)
        if result.get("confirmed") is True:
            self.store.finish(
                row["id"], "sent", DELIVERY_CONFIRMED, result.get("thread_id")
            )
            return CHECK_DONE
        detail = result.get("detail") or DELIVERY_UNCONFIRMED
        with self.store.db:
            self.store.db.execute(
                "UPDATE deliveries SET detail=? WHERE id=?", (detail, row["id"])
            )
        return detail

    async def _check_member(self, item, aid):
        member = self.store.one(
            "SELECT * FROM outreach_members WHERE id=?", (item["member_id"],)
        )
        run = self.store.outreach.run(member["run_id"])
        actions = self.store.rows(
            "SELECT * FROM outreach_actions WHERE member_id=? AND status IN ('unknown','submitting') ORDER BY created DESC",
            (member["id"],),
        )
        if len(actions) > 1 and not all(a["kind"] == "invite" for a in actions):
            raise AppError(
                "Есть несколько неоднозначных действий. Проверьте их в истории отдельно."
            )
        action = actions[0] if actions else None
        if action and action["kind"] != "invite":
            return await self._check_message_action(member, run, action, aid)
        result = await self.rt.worker(aid).call(
            "observe",
            {
                "url": member["url"],
                "check_history": not bool(action),
                "relationship_only": bool(action),
                "recruiter": None if action else run["context"] or None,
            },
        )
        return self.reconcile_contact(member, run, action, result)

    async def _check_message_action(self, member, run, action, aid):
        inmail = action["kind"] == "inmail"
        result = await self.rt.worker(aid).call(
            "verify_delivery",
            {
                "url": member["url"],
                "message": member["inmail_message"] if inmail else member["message"],
                "subject": member["subject"] if inmail else "",
                "since": action["created"],
                "thread_id": action["thread_id"] or member["thread_id"],
                "recruiter": run["context"] if inmail else None,
            },
        )
        current = self.store.one(
            "SELECT status,updated FROM outreach_actions WHERE id=?", (action["id"],)
        )
        current_member = self.store.one(
            "SELECT updated FROM outreach_members WHERE id=?", (member["id"],)
        )
        if (
            current["status"] not in {"unknown", "submitting"}
            or current["updated"] != action["updated"]
            or current_member["updated"] != member["updated"]
        ):
            raise AppError(RESULT_CHANGED)
        if result.get("confirmed") is True:
            self.store.outreach.finish(
                action["id"], "sent", DELIVERY_CONFIRMED, result.get("thread_id")
            )
            self.store.outreach.update_member(
                member["id"],
                status="sent",
                sent_at=action["created"],
                checked_at=now(),
                thread_id=result.get("thread_id"),
                detail="Отправка подтверждена автоматически. Повтор не требуется.",
            )
            return CHECK_DONE
        detail = result.get("detail") or DELIVERY_UNCONFIRMED
        self.store.outreach.update_member(member["id"], detail=detail, checked_at=now())
        return detail

    def reconcile_contact(self, member, run, action, observation):
        repo = self.store.outreach
        current = self.store.one(
            "SELECT updated FROM outreach_members WHERE id=?", (member["id"],)
        )
        if current["updated"] != member["updated"]:
            raise AppError(RESULT_CHANGED)
        run = repo.run(member["run_id"])
        if observation.get("identity_verified") is not True:
            detail = "Автоматическая проверка не подтвердила профиль. Проверьте вход или откройте профиль вручную."
            repo.update_member(member["id"], detail=detail, checked_at=now())
            return detail
        relation = observation.get("relationship", "unknown")
        # History findings only count when no own action is being reconciled.
        history = not action and observation.get("history_verified") is True
        fields = {
            "observation": observation,
            "relationship": relation,
            "checked_at": now(),
        }
        if history and observation.get("has_reply"):
            fields.update(
                status="replied",
                reply_text=observation.get("reply_text", ""),
                detail="Ответ найден в LinkedIn. Продолжите разговор вручную.",
            )
        elif history and observation.get("has_outgoing"):
            fields.update(
                status="excluded",
                detail="В LinkedIn уже начата переписка. Новое обращение не требуется.",
            )
        elif relation in CONTACT_RELATIONS:
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
        elif history and relation == "not_connected":
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
        identity = "review:" + member["id"]
        if self.repairs.offer(identity, member["id"], observation):
            fields["detail"] = (
                "LinkedIn сейчас предлагает приглашение. Можно подтвердить одну новую попытку; старый исход остаётся неизвестным."
            )
            repo.update_member(member["id"], detail=fields["detail"])
            # The explanatory update is part of the proposal snapshot.
            self.repairs.offer(identity, member["id"], observation)
        return fields["detail"]

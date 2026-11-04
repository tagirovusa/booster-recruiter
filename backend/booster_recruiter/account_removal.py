"""Remove one local login slot while preserving contact history and its ledger."""

import shutil

from .store import AppError, now


def deletion_preview(store, aid):
    account = store.account(aid)
    campaigns = store.rows("SELECT id FROM campaigns WHERE account_id=?", (aid,))
    return {
        "id": aid,
        "label": account["label"],
        "campaign_count": len(campaigns),
        "profile_count": store.one(
            "SELECT COUNT(*) AS n FROM candidates p JOIN campaigns c ON c.id=p.campaign_id WHERE c.account_id=?",
            (aid,),
        )["n"],
        "history_count": store.one(
            "SELECT (SELECT COUNT(*) FROM outreach_actions WHERE account_id=?) + "
            "(SELECT COUNT(*) FROM deliveries d JOIN batches b ON b.id=d.batch_id WHERE b.account_id=?) AS n",
            (aid, aid),
        )["n"],
    }


def require_idle(store, runtime):
    if (
        runtime.browser_lock.locked()
        or runtime.campaign_operations
        or any(not task.done() for task in runtime.jobs.values())
        or store.rows(
            "SELECT id FROM campaigns WHERE status IN ('collecting','checking','sending','automating')"
        )
    ):
        raise AppError(
            "Приостановите кампании и дождитесь завершения текущего действия перед удалением аккаунта."
        )


async def remove_account(store, runtime, aid):
    account = store.account(aid)
    require_idle(store, runtime)
    directory = store.root / "accounts"
    target = directory / aid
    if (
        directory.is_symlink()
        or target.is_symlink()
        or target.parent != directory
        or target.name != aid
    ):
        raise AppError(
            "Не удалось безопасно удалить сессию аккаунта. Обратитесь в поддержку."
        )
    # The account ID comes from an existing DB row, but do not allow a modified
    # row to make filesystem removal leave this exact slot directory.
    if not aid or aid in {".", ".."} or "/" in aid or "\\" in aid:
        raise AppError("Не удалось безопасно удалить сессию аккаунта.")
    async with runtime.browser_lock:
        worker = runtime.workers.get(aid)
        if worker:
            await worker.stop(graceful=True)
        # The scheduler may queue a new task while the browser is closing.
        if runtime.campaign_operations or any(
            not task.done() for task in runtime.jobs.values()
        ):
            raise AppError(
                "Началась новая операция. Приостановите кампании и повторите удаление."
            )
        runtime.workers.pop(aid, None)
        try:
            if target.exists():
                shutil.rmtree(target)
        except OSError as exc:
            store.set_account(
                aid,
                "needs_login",
                error="Не удалось полностью удалить локальную сессию. Закройте окно LinkedIn и повторите удаление.",
            )
            raise AppError(
                "Не удалось полностью удалить сессию аккаунта. Закройте окно LinkedIn и повторите удаление."
            ) from exc
        # No await between final readiness check and the tombstone transaction.
        # Do not use identity-wide helpers: another slot may be the same person.
        with store.atomic():
            for campaign in store.rows(
                "SELECT id FROM campaigns WHERE account_id=?", (aid,)
            ):
                cid = campaign["id"]
                runtime.pause_flags.add(cid)
                store.db.execute(
                    "UPDATE campaigns SET status='archived',progress='Аккаунт удалён. История сохранена в архиве.' WHERE id=?",
                    (cid,),
                )
                store.db.execute(
                    "UPDATE batches SET status='cancelled' WHERE campaign_id=? AND status IN ('approved','preview')",
                    (cid,),
                )
                store.db.execute(
                    "UPDATE outreach_runs SET status='cancelled',detail='Аккаунт удалён. Новая отправка недоступна.',updated=? WHERE campaign_id=? AND status IN ('preview','active','paused')",
                    (now(), cid),
                )
            store.db.execute("DELETE FROM account_services WHERE account_id=?", (aid,))
            store.db.execute(
                "UPDATE accounts SET status='deleted',error=NULL WHERE id=?", (aid,)
            )
        store.event(
            "account_deleted",
            f"Удалён аккаунт {account['label']}; история сохранена в архиве.",
        )
    return {"id": aid, "deleted": True, "session_deleted": True}

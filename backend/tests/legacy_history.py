"""Legacy message batches, kept only to build history in tests.

The desktop app no longer creates these batches; existing rows remain as
history and as protection against contacting someone twice.
"""

import hashlib
import json

from booster_recruiter.store import AppError, message_for, now, uid


def legacy_preview(store, cid):
    with store.atomic():
        return legacy__preview(store, cid)


def legacy__preview(store, cid):
    store.ensure_idle(cid)
    campaign = store.campaign(cid)
    account = store.account(campaign["account_id"])
    if account["status"] != "ready":
        raise AppError("Подключите аккаунт отправителя.")
    chosen = store.rows(
        "SELECT * FROM candidates WHERE campaign_id=? AND selected=1 AND excluded=0",
        (cid,),
    )
    messages, skipped = [], []
    for p in chosen:
        if p["segment"] == "review":
            continue
        if store.outreach.blocked(p["url"], campaign_id=cid, account_id=account["id"]):
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
    with store.atomic():
        store.ensure_idle(cid)
        store.invalidate(cid, previews_only=True)
        store.db.execute(
            "INSERT INTO batches VALUES(?,?,?,?,?,?)",
            (bid, cid, campaign["account_id"], digest, "preview", now()),
        )
        for m in messages:
            store.db.execute(
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


def legacy_approve(store, bid, digest):
    with store.atomic():
        batch = store.one("SELECT * FROM batches WHERE id=?", (bid,))
        store.ensure_idle(batch["campaign_id"])
        if batch["status"] != "preview" or batch["digest"] != digest:
            raise AppError("Предпросмотр устарел. Подготовьте сообщения снова.")
        if store.account(batch["account_id"])["status"] != "ready":
            raise AppError("Сначала подтвердите вход отправителя.")
        for row in store.rows("SELECT * FROM deliveries WHERE batch_id=?", (bid,)):
            if row["status"] != "pending" or store.outreach.blocked(
                row["url"],
                campaign_id=batch["campaign_id"],
                account_id=batch["account_id"],
            ):
                raise AppError(
                    "Один из получателей уже обрабатывается. Обновите предпросмотр."
                )
        store.invalidate(batch["campaign_id"])
        store.db.execute("UPDATE batches SET status='approved' WHERE id=?", (bid,))
        store.db.execute(
            "UPDATE deliveries SET status='pending' WHERE batch_id=?", (bid,)
        )
        store.db.execute(
            "UPDATE campaigns SET status='ready',progress='Очередь сообщений подтверждена.' WHERE id=?",
            (batch["campaign_id"],),
        )
    store.event("approval", f"Подтверждена очередь {bid}")
    return batch


def legacy_claim(store, bid):
    with store.atomic():
        rows = store.rows(
            "SELECT d.* FROM deliveries d JOIN batches b ON b.id=d.batch_id WHERE d.batch_id=? AND d.status='pending' AND b.status='approved' ORDER BY d.created,d.id LIMIT 1",
            (bid,),
        )
        if not rows:
            return None
        row = rows[0]
        batch = store.one("SELECT * FROM batches WHERE id=?", (bid,))
        campaign = store.campaign(batch["campaign_id"])
        if store.account(batch["account_id"])["status"] != "ready":
            raise AppError("Подключите аккаунт отправителя перед продолжением очереди.")
        if (
            campaign["status"] == "archived"
            or campaign["account_id"] != batch["account_id"]
        ):
            raise AppError("Отправитель очереди изменился или кампания в архиве.")
        if (
            store.outreach.blocked(
                row["url"],
                campaign_id=batch["campaign_id"],
                account_id=batch["account_id"],
            )
            or store.rows("SELECT url FROM suppression WHERE url=?", (row["url"],))
            or store.rows(
                "SELECT id FROM deliveries WHERE url=? AND id!=? AND status IN ('sending','sent','unknown','replied')",
                (row["url"], row["id"]),
            )
        ):
            store.db.execute(
                "UPDATE deliveries SET status='cancelled',detail='Повторный контакт исключён',updated=? WHERE id=?",
                (now(), row["id"]),
            )
            return {"skip": True}
        store.db.execute(
            "UPDATE deliveries SET status='sending',updated=? WHERE id=? AND status='pending'",
            (now(), row["id"]),
        )
        return row

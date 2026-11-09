from __future__ import annotations

import asyncio
import base64
import hmac
import json
import os
import secrets
import socket
import traceback
from contextlib import asynccontextmanager, suppress
from pathlib import Path

from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

from .browser_engine import browser_engine_info
from .runtime import Runtime
from .store import AppError, Store
from .user_errors import configure as configure_error_log
from .user_errors import record, user_text

# Sending, deleting and restoring are confirmed by the recruiter in the
# desktop window. An agent using the discoverable token (connection.json) can
# prepare work but never approve it.
DESKTOP_ONLY = {
    "outreach.approve",
    "workspace.retry_invitation",
    "backup.restore",
    "account.delete",
    "campaign.delete",
    "shutdown",
}


def create_app(store, runtime, token, desktop_token=None):
    async def command(request: Request):
        supplied = request.headers.get("authorization", "")
        desktop = desktop_token is not None and hmac.compare_digest(
            supplied, "Bearer " + desktop_token
        )
        if not desktop and not hmac.compare_digest(supplied, "Bearer " + token):
            return JSONResponse({"error": "Нет доступа."}, status_code=401)
        if request.headers.get("origin"):
            return JSONResponse(
                {"error": "Браузерные запросы не поддерживаются."}, status_code=403
            )
        raw = await request.body()
        if len(raw) > 1_000_000:
            return JSONResponse({"error": "Запрос слишком большой."}, status_code=413)
        try:
            data = json.loads(raw)
            op = data["op"]
            p = data.get("params", {})
            if op in DESKTOP_ONLY and desktop_token is not None and not desktop:
                return JSONResponse(
                    {
                        "error": "Это действие подтверждается только в окне Booster Recruiter."
                    },
                    status_code=403,
                )
            if op == "state":
                result = store.state()
            elif op == "workspace.summary":
                result = runtime.attention.decorate(store.workspace.summary())
            elif op == "workspace.recheck":
                result = runtime.attention.start(p["id"])
            elif op == "workspace.retry_invitation":
                result = runtime.attention.repairs.start(
                    p["id"], p.get("digest"), p.get("confirm")
                )
            elif op == "workspace.acknowledge":
                result = store.workspace.acknowledge(p["id"])
            elif op == "template.list":
                result = {"templates": store.workspace.templates()}
            elif op == "template.save":
                result = store.workspace.save_template(p["campaign_id"], p["name"])
            elif op == "template.create":
                result = store.workspace.create_from_template(
                    p["id"], p["account_id"], p.get("name")
                )
            elif op == "template.delete":
                result = store.workspace.delete_template(p["id"])
            elif op == "backup.list":
                result = {"backups": store.workspace.backups()}
            elif op == "backup.create":
                result = store.workspace.create_backup()
            elif op == "backup.restore":
                if p.get("confirm") is not True:
                    raise AppError("Подтвердите замену данных резервной копией.")
                if (
                    any(not task.done() for task in runtime.jobs.values())
                    or runtime.browser_lock.locked()
                    or runtime.campaign_operations
                ):
                    raise AppError(
                        "Приостановите кампании и дождитесь завершения текущих действий."
                    )
                if store.rows(
                    "SELECT id FROM campaigns WHERE status IN ('collecting','checking','sending','automating')"
                ):
                    raise AppError("Дождитесь завершения текущих действий кампании.")
                async with runtime.browser_lock:
                    for worker in runtime.workers.values():
                        await worker.stop(graceful=True)
                    # A scheduler may have queued work while workers closed.
                    if (
                        any(not task.done() for task in runtime.jobs.values())
                        or runtime.campaign_operations
                    ):
                        raise AppError(
                            "Началась новая операция. Приостановите кампании перед восстановлением."
                        )
                    runtime.workers.clear()
                    result = store.workspace.restore(p["id"])
                    runtime.pause_flags.clear()
            elif op == "account.deletion_preview":
                from .account_removal import deletion_preview

                result = deletion_preview(store, p["id"])
            elif op == "account.delete":
                from .account_removal import remove_account

                if p.get("confirm") is not True:
                    raise AppError(
                        "Подтвердите удаление аккаунта и его локальной сессии."
                    )
                result = await remove_account(store, runtime, p["id"])
            elif op == "account.create":
                result = store.create_account(p["label"])
            elif op == "account.login":
                store.account(p["id"])
                runtime.ensure_browser_free()
                runtime.spawn("login:" + p["id"], runtime.login(p["id"]))
                result = {"started": True}
            elif op == "account.open_profile":
                result = await runtime.open_profile(p["id"], p["url"])
            elif op in ("account.recruiter", "account.recruiter_prepare"):
                store.account(p["id"])
                runtime.ensure_browser_free()
                runtime.spawn(
                    "recruiter:" + p["id"],
                    runtime.recruiter(p["id"], prepare=op.endswith("_prepare")),
                )
                result = {"started": True}
            elif op == "account.disconnect":
                aid = p["id"]
                store.account(aid)
                if any(not t.done() for t in runtime.jobs.values()):
                    raise AppError(
                        "Сначала приостановите обработку и дождитесь завершения текущей операции."
                    )
                if aid in runtime.workers:
                    await runtime.workers[aid].stop()
                result = store.set_account(aid, "disconnected")
            elif op == "campaign.create":
                result = store.create_campaign(p)
            elif op == "campaign.update":
                result = store.update_campaign(p["id"], p)
            elif op == "campaign.archive":
                result = store.archive_campaign(p["id"])
            elif op == "campaign.restore":
                result = store.restore_campaign(p["id"])
            elif op == "campaign.delete":
                if p.get("confirm") is not True:
                    raise AppError("Подтвердите удаление кампании.")
                runtime.pause_flags.discard(p["id"])
                result = store.delete_campaign(p["id"])
            elif op == "campaign.detail":
                result = store.detail(p["id"])
            elif op == "campaign.collect":
                store.ensure_idle(p["id"])
                runtime.start_campaign(p["id"], runtime.collect(p["id"]), "collecting")
                result = {"started": True}
            elif op == "campaign.pause":
                store.account(store.campaign(p["id"])["account_id"])
                result = await runtime.pause_campaign(p["id"])
            elif op == "campaign.automation":
                result = store.outreach.configure(p["id"], p["rules"])
            elif op == "campaign.save_automation":
                result = store.save_automation(
                    p["id"], p["rules"], p["template_open"], p["template_neutral"]
                )
            elif op == "campaign.check":
                runtime.start_campaign(
                    p["id"], runtime.outreach.check(p["id"]), "checking"
                )
                result = {"started": True}
            elif op == "outreach.preview":
                result = await runtime.outreach_preview(p["id"])
            elif op == "outreach.approve":
                run = store.outreach.approve(p["id"], p["digest"])
                runtime.start_campaign(
                    run["campaign_id"],
                    runtime.outreach.process(run["id"]),
                    "automating",
                )
                result = {"started": True}
            elif op == "outreach.resume":
                run = store.outreach.run(p["id"])
                store.ensure_idle(run["campaign_id"])
                store.outreach.status(run["id"], "active")
                runtime.start_campaign(
                    run["campaign_id"],
                    runtime.outreach.process(run["id"]),
                    "automating",
                )
                result = {"started": True}
            elif op == "outreach.check_now":
                run = store.outreach.check_now(p["id"])
                runtime.start_campaign(
                    run["campaign_id"],
                    runtime.outreach.process(run["id"]),
                    "automating",
                )
                result = {"started": True}
            elif op == "outreach.resolve":
                store.outreach.resolve(p["id"], p["confirmed"])
                result = {"saved": True}
            elif op == "campaign.templates":
                store.templates(p["id"], p["template_open"], p["template_neutral"])
                result = {"saved": True}
            elif op == "candidate.review":
                store.review(
                    p["id"], p["segment"], p["selected"], p.get("excluded", False)
                )
                result = {"saved": True}
            elif op == "candidate.select_many":
                result = store.select_many(p["campaign_id"], p["ids"], p["selected"])
            elif op == "candidate.suppress":
                store.suppress(p["url"], p.get("reason", "Отказ от контакта"))
                result = {"saved": True}
            elif op == "delivery.resolve":
                row = store.one("SELECT * FROM deliveries WHERE id=?", (p["id"],))
                sender = store.one(
                    "SELECT account_id FROM batches WHERE id=?", (row["batch_id"],)
                )
                store.account(sender["account_id"])
                if row["status"] != "unknown":
                    raise AppError("Эта отправка не требует ручной проверки.")
                status = p["status"]
                if status not in ("sent", "blocked"):
                    raise AppError("Подтвердите отправку либо отсутствие сообщения.")
                store.finish(
                    p["id"],
                    status,
                    "Результат вручную проверен пользователем в LinkedIn.",
                )
                result = {"saved": True}
            elif op == "campaign.export":
                fmt = p.get("format", "xlsx")
                result = {
                    "data": base64.b64encode(store.export(p["id"], fmt)).decode(),
                    "filename": f"candidates-{p['id'][:8]}.{fmt}",
                }
            elif op == "diagnostics":
                import platform

                result = {
                    "version": __import__(
                        "importlib.metadata", fromlist=["version"]
                    ).version("booster-recruiter"),
                    "platform": platform.system(),
                    "architecture": platform.machine(),
                    "accounts": len(store.state()["accounts"]),
                    "active_jobs": sum(not t.done() for t in runtime.jobs.values()),
                    "cloud_ai_required": False,
                    "browser_engine": browser_engine_info(),
                }
            elif op == "shutdown":
                await runtime.close()
                result = {"ok": True}
            else:
                raise AppError("Неизвестная операция.")
            return JSONResponse({"result": result})
        except AppError as exc:
            return JSONResponse({"error": user_text(exc)}, status_code=400)
        except (ValueError, KeyError, TypeError) as exc:
            # Validation messages are Russian; KeyError('id') or a TypeError
            # from a bad payload must not reach the recruiter verbatim.
            record(traceback.format_exc())
            text = str(exc) if isinstance(exc, ValueError) else ""
            return JSONResponse(
                {
                    "error": user_text(
                        text,
                        "Не удалось выполнить действие. Обновите окно и попробуйте ещё раз.",
                    )
                },
                status_code=400,
            )
        except Exception:
            record(traceback.format_exc())
            return JSONResponse(
                {
                    "error": "Операция не выполнена. Перезапустите приложение; сохранённые данные останутся."
                },
                status_code=500,
            )

    @asynccontextmanager
    async def lifespan(app):
        store.workspace.try_daily_backup()

        async def backups():
            while True:
                await asyncio.sleep(3600)
                store.workspace.try_daily_backup()

        backup_task = asyncio.create_task(backups())
        runtime.outreach.start()
        try:
            yield
        finally:
            backup_task.cancel()
            with suppress(asyncio.CancelledError):
                await backup_task
        await runtime.close()
        store.db.close()

    return Starlette(
        routes=[Route("/command", command, methods=["POST"])], lifespan=lifespan
    )


def serve(root: Path):
    import uvicorn
    from filelock import FileLock, Timeout

    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    lock = FileLock(str(root / "application.lock"))
    try:
        lock.acquire(timeout=0)
    except Timeout:
        raise SystemExit("Приложение уже использует эту базу данных.")
    token = secrets.token_urlsafe(32)
    # Handed only to the desktop shell over stdout; never written to disk.
    desktop_token = secrets.token_urlsafe(32)
    configure_error_log(root)
    store = Store(root)
    runtime = Runtime(store)
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.bind(("127.0.0.1", 0))
    sock.listen(128)
    connection = {"port": sock.getsockname()[1], "token": token, "pid": os.getpid()}
    discovery = root / "connection.json"
    fd = os.open(discovery, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as stream:
        json.dump(connection, stream)
    print(
        json.dumps({"ready": True, **connection, "desktop_token": desktop_token}),
        flush=True,
    )
    try:
        server = uvicorn.Server(
            uvicorn.Config(
                create_app(store, runtime, token, desktop_token),
                log_level="warning",
                access_log=False,
            )
        )
        asyncio.run(server.serve(sockets=[sock]))
    finally:
        sock.close()
        discovery.unlink(missing_ok=True)
        lock.release()

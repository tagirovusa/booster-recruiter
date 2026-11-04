from __future__ import annotations

import asyncio
import base64
import hmac
import json
import os
import secrets
import socket
from contextlib import asynccontextmanager
from pathlib import Path

from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

from .browser_engine import browser_engine_info
from .runtime import Runtime
from .store import AppError, Store


def create_app(store, runtime, token):
    async def command(request: Request):
        if not hmac.compare_digest(
            request.headers.get("authorization", ""), "Bearer " + token
        ):
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
            if op == "state":
                result = store.state()
            elif op == "account.create":
                result = store.create_account(p["label"])
            elif op == "account.login":
                store.account(p["id"])
                runtime.spawn("login:" + p["id"], runtime.login(p["id"]))
                result = {"started": True}
            elif op == "account.open_profile":
                result = await runtime.open_profile(p["id"], p["url"])
            elif op in ("account.recruiter", "account.recruiter_prepare"):
                store.account(p["id"])
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
            elif op == "campaign.detail":
                result = store.detail(p["id"])
            elif op == "campaign.collect":
                store.ensure_idle(p["id"])
                runtime.start_campaign(p["id"], runtime.collect(p["id"]), "collecting")
                result = {"started": True}
            elif op == "campaign.pause":
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
            elif op == "campaign.preview":
                result = store.preview(p["id"])
            elif op == "batch.approve":
                batch = store.approve(p["id"], p["digest"])
                runtime.start_campaign(
                    batch["campaign_id"], runtime.send_batch(p["id"]), "sending"
                )
                result = {"started": True}
            elif op == "batch.resume":
                batch = store.one("SELECT * FROM batches WHERE id=?", (p["id"],))
                store.ensure_idle(batch["campaign_id"])
                if store.rows(
                    "SELECT d.id FROM deliveries d WHERE d.batch_id=? AND d.status='unknown'",
                    (p["id"],),
                ):
                    raise AppError(
                        "Есть неподтверждённая отправка. Проверьте её в LinkedIn."
                    )
                if batch["status"] != "approved":
                    raise AppError(
                        "Эта очередь больше не действует. Подготовьте новый предпросмотр."
                    )
                runtime.start_campaign(
                    batch["campaign_id"], runtime.send_batch(p["id"]), "sending"
                )
                result = {"started": True}
            elif op == "delivery.resolve":
                row = store.one("SELECT * FROM deliveries WHERE id=?", (p["id"],))
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
        except (AppError, ValueError, KeyError, TypeError) as exc:
            return JSONResponse({"error": str(exc)}, status_code=400)
        except Exception:
            return JSONResponse(
                {
                    "error": "Операция не выполнена. Перезапустите приложение; сохранённые данные останутся."
                },
                status_code=500,
            )

    @asynccontextmanager
    async def lifespan(app):
        runtime.outreach.start()
        yield
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
    store = Store(root)
    runtime = Runtime(store)
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.bind(("127.0.0.1", 0))
    sock.listen(128)
    connection = {"port": sock.getsockname()[1], "token": token, "pid": os.getpid()}
    discovery = root / "connection.json"
    fd = os.open(discovery, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as stream:
        json.dump(connection, stream)
    print(json.dumps({"ready": True, **connection}), flush=True)
    try:
        server = uvicorn.Server(
            uvicorn.Config(
                create_app(store, runtime, token), log_level="warning", access_log=False
            )
        )
        asyncio.run(server.serve(sockets=[sock]))
    finally:
        sock.close()
        discovery.unlink(missing_ok=True)
        lock.release()

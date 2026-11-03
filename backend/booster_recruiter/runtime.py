from __future__ import annotations

import asyncio
import json
import os
import signal
import sys
from pathlib import Path

from .store import AppError, canonical


def executable_args():
    return (
        [sys.executable]
        if getattr(sys, "frozen", False)
        else [sys.executable, "-m", "booster_recruiter"]
    )


class Worker:
    def __init__(self, root, account_id):
        self.root = Path(root) / "accounts" / account_id
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        from booster_linkedin.profile_claim import ensure_profile_claim

        # Claim the newly created isolated directory before adding our log.
        ensure_profile_claim(self.root / "profile", claim_anyway=False)
        self.process = None
        self.lock = asyncio.Lock()
        self.serial = 0
        self.log = None

    async def call(self, action, params=None):
        async with self.lock:
            if not self.process or self.process.returncode is not None:
                self.log = open(self.root / "worker.log", "ab", buffering=0)
                self.process = await asyncio.create_subprocess_exec(
                    *executable_args(),
                    "--worker",
                    str(self.root / "profile"),
                    stdin=asyncio.subprocess.PIPE,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=self.log,
                    env=os.environ.copy(),
                    limit=8 * 1024 * 1024,
                    start_new_session=sys.platform != "win32",
                )
            self.serial += 1
            self.process.stdin.write(
                (
                    json.dumps(
                        {"id": self.serial, "action": action, "params": params or {}}
                    )
                    + "\n"
                ).encode()
            )
            await self.process.stdin.drain()
            try:
                line = await asyncio.wait_for(
                    self.process.stdout.readline(),
                    timeout=90
                    if action in {"observe", "check_reply", "open_profile"}
                    else 300,
                )
            except (TimeoutError, asyncio.CancelledError):
                await self.stop()
                raise
            if not line:
                raise AppError(
                    "Браузерный процесс завершился. Повторно подключите аккаунт."
                )
            data = json.loads(line)
            if data.get("id") != self.serial:
                raise AppError("Нарушена последовательность операций браузера.")
            if "error" in data:
                raise AppError(
                    data["error"] or "Браузер LinkedIn не завершил операцию."
                )
            return data["result"]

    async def stop(self):
        if self.process and self.process.returncode is None:
            if not self.lock.locked():
                # EOF exits the MCP lifespan and closes Chromium cleanly.
                self.process.stdin.close()
                try:
                    await asyncio.wait_for(self.process.wait(), 8)
                except TimeoutError:
                    pass
        if self.process and self.process.returncode is None:
            if sys.platform == "win32":
                killer = await asyncio.create_subprocess_exec(
                    "taskkill",
                    "/PID",
                    str(self.process.pid),
                    "/T",
                    "/F",
                    stdout=asyncio.subprocess.DEVNULL,
                    stderr=asyncio.subprocess.DEVNULL,
                )
                await killer.wait()
            else:
                os.killpg(self.process.pid, signal.SIGTERM)
            try:
                await asyncio.wait_for(self.process.wait(), 8)
            except TimeoutError:
                self.process.kill()
                await self.process.wait()
        if self.log:
            self.log.close()
            self.log = None
        self.process = None


class Runtime:
    def __init__(self, store, worker_factory=Worker):
        self.store = store
        self.factory = worker_factory
        self.workers = {}
        self.jobs = {}
        self.pause_flags = set()
        # A single active browser action across the application also avoids
        # racing a manual account login with a campaign send.
        self.browser_lock = asyncio.Lock()
        from .outreach_runtime import OutreachRuntime

        self.outreach = OutreachRuntime(self)

    def worker(self, aid):
        self.store.account(aid)
        if aid not in self.workers:
            self.workers[aid] = self.factory(self.store.root, aid)
        return self.workers[aid]

    def spawn(self, key, coro):
        if key in self.jobs and not self.jobs[key].done():
            coro.close()
            raise AppError("Эта операция уже выполняется.")
        self.jobs[key] = asyncio.create_task(coro)

    def start_campaign(self, cid, coro, status):
        try:
            self.store.ensure_idle(cid)
        except BaseException:
            coro.close()
            raise
        self.spawn(cid, coro)
        self.pause_flags.discard(cid)
        self.store.progress(
            cid, status, "Ожидаем завершения текущей операции браузера…"
        )

    async def login(self, aid):
        self.store.set_account(aid, "connecting")
        try:
            async with self.browser_lock:
                result = await self.worker(aid).call("login")
            self.store.set_account(
                aid, "ready", result["url"], name=result.get("name") or None
            )
        except Exception as exc:
            self.store.set_account(aid, "needs_login", error=self.friendly(exc))

    @staticmethod
    def friendly(exc):
        if isinstance(exc, TimeoutError):
            return "LinkedIn не ответил вовремя. Обработка приостановлена. Проверьте страницу в браузере и повторно подключите аккаунт."
        text = str(exc)
        if "alias for the signed-in member" in text:
            from .identity import UNRESOLVED_IDENTITY

            return UNRESOLVED_IDENTITY
        if "guardian" in text.casefold():
            return "Не удалось запустить служебный процесс браузера. Окно входа не открыто. Обновите приложение или передайте журнал разработчику."
        if any(
            t in text.casefold()
            for t in ["authentication", "login", "captcha", "checkpoint"]
        ):
            return "Завершите вход или проверку в окне LinkedIn, затем нажмите «Проверить вход»."
        return text[:600]

    async def verify(self, aid):
        account = self.store.account(aid)
        if account["status"] != "ready":
            raise AppError("Аккаунт не готов. Выполните вход.")
        actual = await self.worker(aid).call("login")
        if canonical(actual["url"]) != account["url"]:
            self.store.set_account(aid, "identity_mismatch")
            raise AppError("Аккаунт в браузере изменился. Обработка остановлена.")

    async def collect(self, cid):
        campaign = self.store.campaign(cid)
        aid = campaign["account_id"]
        self.store.progress(cid, "collecting", "Проверяем аккаунт отправителя…")
        try:
            async with self.browser_lock:
                if cid in self.pause_flags:
                    self.store.progress(cid, "paused", "Поиск приостановлен.")
                    return
                await self.verify(aid)
                known = {p["url"] for p in self.store.detail(cid)["candidates"]}
                count = len(known)
                seen_pages = set()
                for page in range(1, 21):
                    if cid in self.pause_flags or count >= campaign["max_profiles"]:
                        break
                    self.store.progress(
                        cid,
                        "collecting",
                        f"Страница {page}. Сохранено {count} профилей.",
                    )
                    result = await self.worker(aid).call(
                        "search", {"keywords": campaign["keywords"], "page": page}
                    )
                    fingerprint = tuple(
                        sorted(p.get("url", "") for p in result["profiles"])
                    )
                    if not fingerprint or fingerprint in seen_pages:
                        break
                    seen_pages.add(fingerprint)
                    links = []
                    for p in result["profiles"]:
                        try:
                            url = canonical(p["url"])
                        except Exception:
                            continue
                        if url not in known:
                            links.append(url)
                            known.add(url)
                    for url in links:
                        if cid in self.pause_flags or count >= campaign["max_profiles"]:
                            break
                        person = await self.worker(aid).call("profile", {"url": url})
                        self.store.add_candidate(cid, person)
                        count += 1
                        self.store.progress(
                            cid,
                            "collecting",
                            f"Сохранено {count} из {campaign['max_profiles']}. Проверяем следующий профиль…",
                        )
                self.store.progress(
                    cid,
                    "paused" if cid in self.pause_flags else "ready",
                    f"Сохранено {count} профилей. Проверьте группы и выберите получателей.",
                )
        except Exception as exc:
            self.store.progress(cid, "paused", self.friendly(exc))
            self.store.event("collection_stopped", f"{cid}: {self.friendly(exc)}")

    async def open_profile(self, aid, url):
        url = canonical(url)
        if self.browser_lock.locked():
            raise AppError(
                "Браузер занят. Приостановите обработку и дождитесь завершения текущего действия."
            )
        async with self.browser_lock:
            await self.verify(aid)
            return await self.worker(aid).call("open_profile", {"url": url})

    async def send_batch(self, bid):
        batch = self.store.one("SELECT * FROM batches WHERE id=?", (bid,))
        cid = batch["campaign_id"]
        aid = batch["account_id"]
        if batch["status"] != "approved":
            raise AppError("Очередь не подтверждена в приложении.")
        self.store.progress(cid, "sending", "Проверяем аккаунт и очередь…")
        try:
            async with self.browser_lock:
                if cid in self.pause_flags:
                    self.store.progress(cid, "paused", "Отправка приостановлена.")
                    return
                if self.store.rows(
                    "SELECT id FROM deliveries WHERE batch_id=? AND status='unknown'",
                    (bid,),
                ):
                    raise AppError(
                        "Сначала проверьте неподтверждённую отправку в истории кампании."
                    )
                await self.verify(aid)
                sent = 0
                while cid not in self.pause_flags:
                    # A budget is an application stop condition, not a promise
                    # about LinkedIn's permitted sending volume.
                    today = self.store.rows(
                        "SELECT d.id FROM deliveries d JOIN batches b ON b.id=d.batch_id WHERE b.account_id=? AND d.status IN ('sent','unknown','sending','blocked','failed','replied') AND substr(d.updated,1,10)=substr(?,1,10)",
                        (
                            aid,
                            __import__("datetime")
                            .datetime.now(__import__("datetime").timezone.utc)
                            .isoformat(),
                        ),
                    )
                    if len(today) >= 20:
                        raise AppError(
                            "Достигнут дневной бюджет приложения: 20 попыток. Оставшаяся очередь сохранена."
                        )
                    row = self.store.claim(bid)
                    if not row:
                        break
                    if row.get("skip"):
                        continue
                    self.store.progress(
                        cid,
                        "sending",
                        f"Отправляем подготовленное сообщение. Завершено: {sent}.",
                    )
                    try:
                        result = await self.worker(aid).call(
                            "send", {"url": row["url"], "message": row["message"]}
                        )
                    except BaseException:
                        self.store.finish(
                            row["id"],
                            "unknown",
                            "Ответ браузера не получен. Проверьте диалог перед дальнейшими действиями.",
                        )
                        raise
                    if result.get("sent") is True:
                        self.store.finish(
                            row["id"],
                            "sent",
                            "Появление сообщения подтверждено в LinkedIn.",
                            result.get("thread_id"),
                        )
                        sent += 1
                    elif result.get("retry_safe") is True:
                        self.store.finish(
                            row["id"],
                            "blocked",
                            result.get("message")
                            or result.get("status", "Недоступно обычное сообщение"),
                        )
                    else:
                        self.store.finish(
                            row["id"],
                            "unknown",
                            result.get("message")
                            or "Результат отправки не подтверждён.",
                        )
                        raise AppError(
                            "Результат последней отправки неизвестен. Очередь остановлена для проверки."
                        )
                    await asyncio.sleep(7)
                self.store.progress(
                    cid,
                    "paused" if cid in self.pause_flags else "ready",
                    f"Обработка завершена. Подтверждено сообщений в этой сессии: {sent}.",
                )
        except Exception as exc:
            self.store.progress(cid, "paused", self.friendly(exc))

    async def close(self):
        await self.outreach.stop()
        self.pause_flags.update(self.jobs)
        for task in self.jobs.values():
            if not task.done():
                task.cancel()
        await asyncio.gather(*self.jobs.values(), return_exceptions=True)
        await asyncio.gather(
            *(w.stop() for w in self.workers.values()), return_exceptions=True
        )

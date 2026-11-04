from __future__ import annotations

import asyncio
import json
import os
import signal
import sys
from contextlib import asynccontextmanager
from pathlib import Path

from .platform_limits import (
    LinkedInAccountRestrictedError,
    LinkedInChallengeError,
    LinkedInLimitError,
)
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
        self.visible = None

    async def call(self, action, params=None):
        async with self.lock:
            visible = (
                action == "open_profile" or (params or {}).get("interactive") is True
            )
            if (
                self.process
                and self.process.returncode is None
                and self.visible != visible
            ):
                # The previous request has completed under this lock. Close its
                # browser before reopening the same persistent profile in a new mode.
                await self.stop(graceful=True)
            if not self.process or self.process.returncode is not None:
                self.log = open(self.root / "worker.log", "ab", buffering=0)
                self.process = await asyncio.create_subprocess_exec(
                    *executable_args(),
                    "--worker",
                    str(self.root / "profile"),
                    *(["--browser-visible"] if visible else []),
                    stdin=asyncio.subprocess.PIPE,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=self.log,
                    env=os.environ.copy(),
                    limit=8 * 1024 * 1024,
                    start_new_session=sys.platform != "win32",
                )
                self.visible = visible
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
                    timeout=180
                    if action in {"observe", "check_reply"}
                    and (params or {}).get("recruiter")
                    else 90
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
                error_type = {
                    "linkedin_limit": LinkedInLimitError,
                    "linkedin_auth_required": LinkedInChallengeError,
                    "linkedin_account_restricted": LinkedInAccountRestrictedError,
                }.get(data.get("error_code"), AppError)
                raise error_type(
                    data["error"] or "Браузер LinkedIn не завершил операцию."
                )
            return data["result"]

    async def stop(self, *, graceful=None):
        if self.process and self.process.returncode is None:
            if graceful is True or (graceful is None and not self.lock.locked()):
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
        self.visible = None


class Runtime:
    def __init__(self, store, worker_factory=Worker):
        self.store = store
        self.factory = worker_factory
        self.workers = {}
        self.jobs = {}
        self.pause_flags = set()
        self.pause_generations = {}
        self.campaign_operations = {}
        self.active_campaign_tasks = set()
        # A single active browser action across the application also avoids
        # racing a manual account login with a campaign send.
        self.browser_lock = asyncio.Lock()
        from .outreach_runtime import OutreachRuntime

        self.outreach = OutreachRuntime(self)
        from .attention_recovery import AttentionRecovery

        self.attention = AttentionRecovery(self)

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

    @asynccontextmanager
    async def campaign_browser(self, cid, status, progress):
        """Track the exact task while queued and while it owns the browser."""
        task = asyncio.current_task()
        self.campaign_operations[cid] = task
        self.store.progress(
            cid, status, "Ожидаем завершения текущей операции браузера…"
        )
        try:
            async with self.browser_lock:
                self.active_campaign_tasks.add(task)
                try:
                    if cid not in self.pause_flags:
                        self.store.progress(cid, status, progress)
                    yield
                except LinkedInAccountRestrictedError:
                    aid = self.store.campaign(cid)["account_id"]
                    self.restrict_account(aid)
                    raise
                except LinkedInChallengeError as exc:
                    aid = self.store.campaign(cid)["account_id"]
                    self.pause_for_challenge(aid, self.friendly(exc))
                    raise
                finally:
                    self.active_campaign_tasks.discard(task)
        finally:
            if self.campaign_operations.get(cid) is task:
                self.campaign_operations.pop(cid, None)

    async def pause_campaign(self, cid):
        self.store.campaign(cid)
        # A repeated pause still revokes an explicit repair waiting for the
        # browser lock, even when this campaign was already paused.
        self.pause_generations[cid] = self.pause_generations.get(cid, 0) + 1
        self.pause_flags.add(cid)
        for run in self.store.outreach.detail(cid)["runs"]:
            if run["status"] == "active":
                self.store.outreach.status(
                    run["id"], "paused", "Приостановлено пользователем."
                )
        task = self.campaign_operations.get(cid) or self.jobs.get(cid)
        active = task in self.active_campaign_tasks
        if task and not task.done() and not active:
            # No browser action can have started while this exact task is
            # queued. Cancel only its wait, never an in-flight browser call.
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
        if active and not task.done():
            campaign = self.store.campaign(cid)
            self.store.progress(
                cid,
                campaign["status"],
                "Приостанавливаем: ждём завершения текущего действия LinkedIn…",
            )
        else:
            self.store.progress(cid, "paused", "Кампания приостановлена пользователем.")
        return {"pause_requested": True, "paused": not active}

    async def login(self, aid):
        self.store.set_account(aid, "connecting")
        try:
            async with self.browser_lock:
                result = await self.worker(aid).call("login", {"interactive": True})
            self.store.set_account(
                aid, "ready", result["url"], name=result.get("name") or None
            )
        except Exception as exc:
            if isinstance(exc, LinkedInChallengeError):
                self.pause_for_challenge(aid, self.friendly(exc))
            elif isinstance(exc, LinkedInAccountRestrictedError):
                self.restrict_account(aid)
                return
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

    async def verify(self, aid, *, interactive=False):
        account = self.store.account(aid)
        if account["status"] != "ready":
            raise AppError("Аккаунт не готов. Выполните вход.")
        actual = await self.worker(aid).call("login", {"interactive": interactive})
        if canonical(actual["url"]) != account["url"]:
            self.store.set_account(aid, "identity_mismatch")
            raise AppError("Аккаунт в браузере изменился. Обработка остановлена.")
        return actual

    def pause_sender(self, aid, detail):
        """Pause every queued campaign for this identity after a platform limit."""
        sender_ids = self.store.outreach.sender_ids(aid)
        placeholders = ",".join("?" for _ in sender_ids)
        for campaign in self.store.rows(
            f"SELECT id FROM campaigns WHERE account_id IN ({placeholders})",
            sender_ids,
        ):
            cid = campaign["id"]
            self.pause_generations[cid] = self.pause_generations.get(cid, 0) + 1
            # Includes a legacy batch or a task already queued for browser access.
            self.pause_flags.add(cid)
            if cid in self.jobs or self.store.rows(
                "SELECT 1 FROM outreach_runs WHERE campaign_id=? AND status='active' "
                "UNION SELECT 1 FROM batches WHERE campaign_id=? AND status='approved'",
                (cid, cid),
            ):
                self.store.progress(cid, "paused", detail)
        for run in self.store.rows(
            f"SELECT id FROM outreach_runs WHERE account_id IN ({placeholders}) AND status='active'",
            sender_ids,
        ):
            self.store.outreach.status(run["id"], "paused", detail)
        return detail

    def pause_for_challenge(self, aid, detail):
        for sender_id in self.store.outreach.sender_ids(aid):
            self.store.set_account(sender_id, "needs_login", error=detail)
        self.pause_sender(aid, detail)

    def restrict_account(self, aid):
        detail = "LinkedIn ограничил действия аккаунта. Кампания приостановлена."
        sender_ids = self.store.outreach.sender_ids(aid)
        for sender_id in sender_ids:
            self.store.set_account(sender_id, "restricted", error=detail)
        placeholders = ",".join("?" for _ in sender_ids)
        for run in self.store.rows(
            f"SELECT id FROM outreach_runs WHERE account_id IN ({placeholders}) AND status='active'",
            sender_ids,
        ):
            self.store.outreach.status(run["id"], "paused", detail)
        return detail

    async def recruiter(self, aid, prepare=False):
        self.store.set_service(aid, "recruiter", {"status": "connecting"})
        try:
            async with self.browser_lock:
                await self.verify(aid, interactive=True)
                result = await self.worker(aid).call(
                    "recruiter_prepare" if prepare else "recruiter_status",
                    {"interactive": True},
                )
            self.store.set_service(aid, "recruiter", result)
        except Exception as exc:
            if isinstance(exc, LinkedInChallengeError):
                self.pause_for_challenge(aid, self.friendly(exc))
            elif isinstance(exc, LinkedInAccountRestrictedError):
                self.restrict_account(aid)
            self.store.set_service(
                aid, "recruiter", {"status": "needs_login", "error": self.friendly(exc)}
            )

    async def outreach_preview(self, cid):
        rules = self.store.outreach.rules(cid)
        if not rules["allow_inmail"] or rules["inmail_channel"] != "recruiter":
            return self.store.outreach.preview(cid)
        self.store.ensure_idle(cid)
        campaign = self.store.campaign(cid)
        service = self.store.account(campaign["account_id"])["services"].get(
            "recruiter", {}
        )
        if service.get("status") != "ready":
            raise AppError("Подключите Recruiter на странице аккаунтов отправителя.")
        eligible = [
            p
            for p in self.store.detail(cid)["candidates"]
            if p["selected"] and p["outreach_eligible"]
        ]
        if not eligible:
            raise AppError("Выберите получателей без прежних обращений.")
        self.pause_flags.discard(cid)
        try:
            async with self.campaign_browser(
                cid, "checking", "Проверяем Recruiter и подпись для предпросмотра…"
            ):
                if cid in self.pause_flags:
                    raise AppError("Предпросмотр приостановлен пользователем.")
                identity = await self.verify(campaign["account_id"])
                context = await self.worker(campaign["account_id"]).call(
                    "recruiter_preview",
                    {"url": eligible[0]["url"], "contract": service["contract"]},
                )
                context["sender_name"] = identity["name"]
            if cid in self.pause_flags:
                raise AppError("Предпросмотр приостановлен пользователем.")
            self.store.progress(cid, "ready", "Тексты и подпись Recruiter проверены.")
            return self.store.outreach.preview(cid, recruiter_context=context)
        except BaseException:
            if cid in self.pause_flags:
                self.store.progress(
                    cid, "paused", "Предпросмотр приостановлен пользователем."
                )
            else:
                self.store.progress(cid, campaign["status"], campaign["progress"])
            raise

    async def collect(self, cid):
        campaign = self.store.campaign(cid)
        aid = campaign["account_id"]
        try:
            async with self.campaign_browser(
                cid, "collecting", "Проверяем аккаунт отправителя…"
            ):
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
                        f"Страница {page}. Профилей сохранено: {count}.",
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
                    f"Профилей сохранено: {count}. Проверьте группы и выберите получателей.",
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
        try:
            async with self.browser_lock:
                await self.verify(aid, interactive=True)
                return await self.worker(aid).call("open_profile", {"url": url})
        except LinkedInChallengeError as exc:
            self.pause_for_challenge(aid, self.friendly(exc))
            raise
        except LinkedInAccountRestrictedError:
            self.restrict_account(aid)
            raise

    async def send_batch(self, bid):
        batch = self.store.one("SELECT * FROM batches WHERE id=?", (bid,))
        cid = batch["campaign_id"]
        aid = batch["account_id"]
        if batch["status"] != "approved":
            raise AppError("Очередь не подтверждена в приложении.")
        try:
            async with self.campaign_browser(
                cid, "sending", "Проверяем аккаунт и очередь…"
            ):
                if cid in self.pause_flags:
                    self.store.progress(cid, "paused", "Отправка приостановлена.")
                    return
                await self.verify(aid)
                sent = 0
                verify_before_next = False
                while cid not in self.pause_flags:
                    if verify_before_next:
                        if not self.store.rows(
                            "SELECT d.id FROM deliveries d JOIN batches b ON b.id=d.batch_id WHERE d.batch_id=? AND d.status='pending' AND b.status='approved'",
                            (bid,),
                        ):
                            break
                        await self.verify(aid)
                        verify_before_next = False
                        if cid in self.pause_flags:
                            break
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
                    except BaseException as exc:
                        self.store.finish(
                            row["id"],
                            "unknown",
                            "Ответ браузера не получен. Этот получатель отложен для проверки; повтор исключён.",
                        )
                        if (
                            not isinstance(exc, Exception)
                            or isinstance(
                                exc,
                                (
                                    LinkedInAccountRestrictedError,
                                    LinkedInChallengeError,
                                    LinkedInLimitError,
                                ),
                            )
                            or self.store.account(aid)["status"] != "ready"
                        ):
                            raise
                        await self.outreach.reset_profile_browser(aid)
                        verify_before_next = True
                        continue
                    restriction = (
                        self.restrict_account(aid)
                        if result.get("account_restricted")
                        else None
                    )
                    challenge = result.get("auth_required") and not restriction
                    if challenge:
                        self.pause_for_challenge(
                            aid,
                            result.get("message")
                            or "Завершите проверку в окне LinkedIn.",
                        )
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
                    if result.get("platform_limited"):
                        raise LinkedInLimitError(
                            result.get("message")
                            or "LinkedIn сообщил о лимите отправки."
                        )
                    if challenge:
                        raise LinkedInChallengeError(
                            result.get("message")
                            or "Завершите проверку в окне LinkedIn."
                        )
                    if restriction:
                        raise AppError(restriction)
                    if result.get("sent") is not True:
                        await self.outreach.reset_profile_browser(aid)
                        verify_before_next = True
                self.store.progress(
                    cid,
                    "paused" if cid in self.pause_flags else "ready",
                    f"Обработка завершена. Подтверждено сообщений в этой сессии: {sent}."
                    + (
                        " Отдельные получатели требуют проверки; повторная отправка им заблокирована."
                        if self.store.rows(
                            "SELECT id FROM deliveries WHERE batch_id=? AND status='unknown'",
                            (bid,),
                        )
                        else ""
                    ),
                )
        except Exception as exc:
            self.pause_sender(aid, self.friendly(exc))
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

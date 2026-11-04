"""One process per account: vendor singletons never cross account boundaries."""

from __future__ import annotations

import asyncio
import contextlib
import json
import os
import re
import sys
from pathlib import Path
from urllib.parse import urlencode, urlsplit

from booster_linkedin.linkedin.identifiers import (
    normalize_person_identifier,
    person_profile_url,
)

from .identity import PROFILE_JS, resolve_own_profile
from .pacing import BrowserPacer
from .platform_limits import (
    LinkedInAccountRestrictedError,
    LinkedInChallengeError,
    LinkedInLimitError,
    check_after_browser_action,
    check_platform_limit,
)

SEARCH_JS = r"""() => {
 const main=document.querySelector('main'); if(!main)return [];
 const visible=e=>!!e&&e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden';
 const screens=[...main.querySelectorAll('[data-sdui-screen="com.linkedin.sdui.flagshipnav.search.SearchResultsPeople"]')].filter(visible);
 if(screens.length!==1)return [];
 const markers=[...screens[0].querySelectorAll('[componentkey="SearchResults_FirstResult_people"]')].filter(visible);
 if(markers.length!==1)return [];
 const list=markers[0].closest('[role="list"]');
 if(!list||!screens[0].contains(list))return [];
 const profile=a=>{try{const u=new URL(a.href,location.href);
  if(u.protocol!=='https:'||u.username||u.password||!/(^|\.)linkedin\.com$/.test(u.hostname))return null;
  const match=u.pathname.match(/^\/in\/([^/]+)\/?$/);
  return match?'https://www.linkedin.com/in/'+match[1]:null;
 }catch{return null;}};
 const found=new Map();
 for(const row of list.querySelectorAll('[role="listitem"]')) {
  if(!visible(row)||row.closest('[role="list"]')!==list||row.closest('aside,nav,header,footer'))continue;
  // One result owns this primary clickable profile wrapper. Its nested
  // mutual-connection links are context, never additional search results.
  const links=[...row.querySelectorAll('a[href][tabindex="0"][componentkey]')].filter(a=>visible(a)&&profile(a));
  const identities=[...new Set(links.map(profile))];
  if(identities.length!==1)continue;
  const url=identities[0];
  const names=[...row.querySelectorAll('a[href]')].filter(e=>visible(e)&&profile(e)===url).map(e=>(e.innerText||'').trim());
  const labels=[...names,...links.map(a=>(a.getAttribute('aria-label')||a.innerText||'').trim())].filter(Boolean).sort((a,b)=>a.length-b.length);
  const label=labels[0];
  if(!label)continue;
  found.set(url,label.slice(0,200));
 }
 return Array.from(found,([url,label])=>({url,label}));
}"""


def direct_profile_search(keywords, page=1):
    """An explicitly pasted profile URL is one target, never a keyword slug."""
    value = keywords.strip()
    if not re.match(r"(?i)^https?:", value):
        return None
    parsed = urlsplit(value)
    if (
        parsed.scheme.lower() not in {"http", "https"}
        or parsed.username is not None
        or parsed.password is not None
        or re.fullmatch(r"/in/[^/]+/?", parsed.path) is None
    ):
        raise ValueError(
            "Вставьте полную ссылку на профиль LinkedIn вида https://www.linkedin.com/in/имя."
        )
    username = normalize_person_identifier(value)
    url = person_profile_url(username)
    return [{"url": url, "label": username}] if page == 1 else []


async def serve(profile: Path, *, visible=False):
    from .browser_engine import verify_browser_engine

    verify_browser_engine()
    from booster_linkedin.bootstrap import configure_browser_environment
    from booster_linkedin.config import set_config
    from booster_linkedin.config.loaders import load_config
    from booster_linkedin.core.exceptions import (
        AccountRestrictedError,
        AuthenticationError,
        RateLimitError,
    )
    from booster_linkedin.dependencies import get_ready_extractor
    from booster_linkedin.drivers.browser import get_or_create_browser, set_headless
    from booster_linkedin.linkedin import photo_frame_detection
    from booster_linkedin.linkedin.session import PageSession
    from booster_linkedin.profile_claim import ensure_profile_claim
    from booster_linkedin.server import create_mcp_server
    from fastmcp import Client

    from .ocr import detect

    args = [
        "--no-daemon",
        "--user-data-dir",
        str(profile),
        "--no-auto-import",
        "--login-inline-wait",
        "5",
        "--browser-idle-timeout",
        "0",
    ]
    if visible:
        args.append("--no-headless")
    from .selftest import bundled_browsers

    bundled_browsers()
    browser_path = (
        None if getattr(sys, "frozen", False) else os.environ.get("BOOSTER_BROWSER")
    )
    if not browser_path:
        from patchright.async_api import async_playwright

        if os.environ.get("PLAYWRIGHT_BROWSERS_PATH"):
            async with async_playwright() as playwright:
                browser_path = playwright.chromium.executable_path
            if not Path(browser_path).is_file():
                raise RuntimeError(
                    "Встроенный браузер не найден. Переустановите приложение."
                )
    if browser_path:
        args += ["--chrome-path", browser_path]
    config = load_config(args)
    # Explicit desktop intent wins over inherited shell configuration. Campaigns
    # use Chromium's native headless mode; manual login and review use a window.
    config.browser.headless = not visible
    config.browser.native_headless = not visible
    set_config(config)
    # Embedded servers bypass the CLI that normally applies the process mode.
    set_headless(config.browser.headless)
    configure_browser_environment()
    ensure_profile_claim(profile, claim_anyway=False)

    # The vendor reader keeps its attribution checks. Only its OCR backend is
    # replaced, avoiding dependence on a user's installed Swift toolchain.
    async def portable_ocr(png):
        try:
            result = await asyncio.to_thread(detect, png)
            return [
                {
                    "text": e["text"],
                    "confidence": e["confidence"],
                    "region": "avatar_perimeter",
                }
                for e in result["evidence"]
            ], None
        except Exception:
            return [], "local_ocr_failed"

    photo_frame_detection._run_local_ocr = portable_ocr
    pacer = BrowserPacer()
    async with Client(create_mcp_server(), timeout=240) as client:

        async def call(name, arguments):
            await pacer.step()
            result = await client.call_tool(name, arguments, raise_on_error=False)
            if result.is_error:
                meta = result.meta or {}
                if (
                    meta.get("linkedin.dev/error", {}).get("code")
                    == "account_restricted"
                ):
                    raise LinkedInAccountRestrictedError(
                        "LinkedIn ограничил действия аккаунта. Кампании приостановлены."
                    )
                if meta.get("linkedin.dev/error", {}).get("code") == "auth_required":
                    raise LinkedInChallengeError(
                        "Завершите вход или проверку в окне LinkedIn, затем нажмите «Проверить вход»."
                    )
                if meta.get("linkedin.dev/error", {}).get("code") == "rate_limited":
                    raise LinkedInLimitError(
                        "LinkedIn временно ограничил действия. Очереди аккаунта приостановлены; продолжите после снятия ограничения."
                    )
                raise RuntimeError(
                    json.dumps(
                        {
                            "message": " ".join(
                                getattr(c, "text", "") for c in result.content
                            ),
                            "meta": meta,
                        },
                        ensure_ascii=False,
                    )
                )
            data = result.structured_content or {}
            if data.get("section_errors"):
                raise RuntimeError(
                    "LinkedIn не отдал раздел профиля: "
                    + json.dumps(data["section_errors"], ensure_ascii=False)[:600]
                )
            return data, result

        while True:
            line = await asyncio.to_thread(sys.stdin.readline)
            if not line:
                break
            request = json.loads(line)
            action = request["action"]
            p = request.get("params", {})
            try:
                await pacer.wait_command()
                if action == "login":
                    result, _ = await call("get_my_profile", {})
                    browser = await get_or_create_browser()
                    result = await resolve_own_profile(
                        PageSession(browser.page), result["url"]
                    )
                elif action == "search":
                    direct = direct_profile_search(p["keywords"], int(p.get("page", 1)))
                    if direct is not None:
                        result = {
                            "profiles": direct,
                            "url": direct[0]["url"] if direct else "",
                            "text": "",
                        }
                        payload = {"id": request["id"], "result": result}
                        sys.__stdout__.write(
                            json.dumps(payload, ensure_ascii=False) + "\n"
                        )
                        sys.__stdout__.flush()
                        continue
                    extractor = await get_ready_extractor(
                        None, tool_name="search_people"
                    )
                    url = (
                        "https://www.linkedin.com/search/results/people/?"
                        + urlencode(
                            {"keywords": p["keywords"], "page": int(p.get("page", 1))}
                        )
                    )
                    await pacer.step()
                    extracted = await extractor.extract_page(
                        url, "search_results", max_scrolls=2
                    )
                    browser = await get_or_create_browser()
                    session = PageSession(browser.page)
                    await session.check_rate_limit()
                    links = await session.run_on_linkedin(SEARCH_JS)
                    result = {"profiles": links, "url": url, "text": extracted.text}
                elif action == "profile":
                    raw, _ = await call(
                        "get_person_profile", {"linkedin_username": p["url"]}
                    )
                    browser = await get_or_create_browser()
                    person = await PageSession(browser.page).run_on_linkedin(PROFILE_JS)
                    if not person.get("name"):
                        raise RuntimeError(
                            "Не удалось определить владельца профиля. Сбор остановлен для проверки страницы."
                        )
                    frame, image_result = await call(
                        "get_profile_photo_frame", {"linkedin_username": p["url"]}
                    )
                    for block in image_result.content:
                        if getattr(block, "type", None) == "image":
                            person["photo"] = block.data
                    person.update(
                        url=raw["url"],
                        profile_urn=raw.get("profile_urn"),
                        sections=raw.get("sections", {}),
                        photo_frame=frame["photo_frame"],
                    )
                    result = person
                elif action in (
                    "observe",
                    "verify_delivery",
                    "invite",
                    "send_free",
                    "send_inmail",
                    "check_reply",
                    "open_profile",
                    "recruiter_status",
                    "recruiter_prepare",
                    "recruiter_preview",
                ):
                    from .outreach_browser import BrowserOutreach

                    await get_ready_extractor(None, tool_name="get_person_profile")
                    browser = await get_or_create_browser()

                    async def read_profile(username):
                        data, _ = await call(
                            "get_person_profile", {"linkedin_username": username}
                        )
                        return data

                    async def read_conversation(arguments):
                        return await call("get_conversation", arguments)

                    outreach = BrowserOutreach(
                        browser.page, read_profile, read_conversation, pacer=pacer
                    )
                    await check_platform_limit(outreach.session)
                    if action.startswith("recruiter_"):
                        from .recruiter_browser import RecruiterBrowser

                        recruiter = RecruiterBrowser(
                            browser.page,
                            outreach.session,
                            outreach.navigator,
                            pacer=pacer,
                        )
                        if action == "recruiter_prepare":
                            result = await recruiter.prepare_manual_texts()
                        else:
                            result = await recruiter.status()
                            if action == "recruiter_preview":
                                if (
                                    result["contract"] != p["contract"]
                                    or not result["manual_texts"]
                                ):
                                    raise RuntimeError(
                                        "Проверьте контракт и отключите автотексты в подключении Recruiter."
                                    )
                                observed = await recruiter.observe(p["url"], result)
                                if not observed.get("inmail"):
                                    raise RuntimeError(
                                        observed.get(
                                            "detail", "Редактор InMail недоступен."
                                        )
                                    )
                                result["signature"] = observed["signature"]
                    elif action == "open_profile":
                        result = await outreach.open_profile(p["url"])
                    elif action == "observe":
                        result = await outreach.observe(
                            p["url"],
                            p.get("check_history", False),
                            p.get("relationship_only", False),
                        )
                        if (
                            p.get("recruiter")
                            and result.get("identity_verified")
                            and not any(
                                result.get(k)
                                for k in ("free_message", "has_reply", "has_outgoing")
                            )
                        ):
                            from .recruiter_browser import RecruiterBrowser

                            recruiter = RecruiterBrowser(
                                browser.page,
                                outreach.session,
                                outreach.navigator,
                                pacer=pacer,
                            )
                            status = await recruiter.status()
                            if (
                                status["contract"] != p["recruiter"]["contract"]
                                or not status["manual_texts"]
                            ):
                                raise RuntimeError(
                                    "Изменилось подключение Recruiter. Проверьте контракт и настройки текстов."
                                )
                            observed = await recruiter.observe(p["url"], p["recruiter"])
                            # The composer reflects this recipient's actual channel
                            # and available balance; the contract pool may differ.
                            result.update(observed)
                            if observed.get("recruiter_has_history"):
                                result["has_outgoing"] = True
                    elif action == "verify_delivery":
                        if p.get("recruiter") or (p.get("thread_id") or "").startswith(
                            "recruiter:"
                        ):
                            result = {
                                "confirmed": False,
                                "detail": "Для этой старой отправки Recruiter нет сохранённого подтверждения. Проверьте переписку вручную; повтор не выполнялся.",
                            }
                        else:
                            result = await outreach.verify_delivery(
                                p["url"],
                                p["message"],
                                p["since"],
                                p.get("thread_id"),
                                p.get("subject", ""),
                            )
                    elif action == "invite":
                        result = await outreach.invite(p["url"], p.get("note", ""))
                    elif action == "check_reply":
                        if p.get("recruiter") or (p.get("thread_id") or "").startswith(
                            "recruiter:"
                        ):
                            from .recruiter_browser import RecruiterBrowser

                            if not p.get("recruiter"):
                                raise RuntimeError(
                                    "Не сохранён контракт переписки Recruiter."
                                )
                            result = await RecruiterBrowser(
                                browser.page,
                                outreach.session,
                                outreach.navigator,
                                pacer=pacer,
                            ).check_reply(
                                p["url"],
                                p.get("thread_id"),
                                p["recruiter"],
                                p.get("message", ""),
                                p.get("subject", ""),
                            )
                        else:

                            async def open_conversation(arguments):
                                return await call("get_conversation", arguments)

                            result = await outreach.check_reply(
                                p["url"], p.get("thread_id"), open_conversation
                            )
                    else:
                        if action == "send_inmail" and p.get("recruiter"):
                            from .recruiter_browser import RecruiterBrowser

                            recruiter = RecruiterBrowser(
                                browser.page,
                                outreach.session,
                                outreach.navigator,
                                pacer=pacer,
                            )
                            result = await recruiter.send(
                                p["url"],
                                p["message"],
                                p["subject"],
                                p["recruiter"],
                                p["credit_cost"],
                            )
                        else:
                            result = await outreach.send(
                                p["url"],
                                p["message"],
                                p.get("subject") if action == "send_inmail" else None,
                            )
                elif action == "send":
                    from .outreach_browser import PacedMessageSender, PacedNavigator

                    browser = await get_or_create_browser()
                    session = PageSession(browser.page)
                    await check_platform_limit(session)
                    result = await PacedMessageSender(
                        session, PacedNavigator(session, pacer), pacer=pacer
                    ).send_message(p["url"], p["message"], confirm_send=True)
                elif action == "conversation":
                    result, _ = await call(
                        "get_conversation", {"linkedin_username": p["url"]}
                    )
                elif action == "close":
                    await call("close_session", {})
                    result = {"ok": True}
                else:
                    raise ValueError("Unknown worker command")
                if action != "close":
                    browser = await get_or_create_browser()
                    result = await check_after_browser_action(
                        PageSession(browser.page),
                        result,
                        outgoing=action
                        in {"invite", "send_free", "send_inmail", "send"},
                    )
                payload = {"id": request["id"], "result": result}
            except Exception as exc:
                payload = {
                    "id": request["id"],
                    "error_code": "linkedin_account_restricted"
                    if isinstance(
                        exc, (LinkedInAccountRestrictedError, AccountRestrictedError)
                    )
                    else "linkedin_limit"
                    if isinstance(exc, (LinkedInLimitError, RateLimitError))
                    else "linkedin_auth_required"
                    if isinstance(exc, (LinkedInChallengeError, AuthenticationError))
                    else "browser_error",
                    "error": (str(exc) or "Браузер LinkedIn не завершил операцию.")[
                        :1800
                    ],
                }
            finally:
                pacer.finish_command()
            sys.__stdout__.write(json.dumps(payload, ensure_ascii=False) + "\n")
            sys.__stdout__.flush()
            if action == "close":
                break


def main(profile, *, visible=False):
    # Browser setup and library progress may print. Reserve stdout for RPC.
    with contextlib.redirect_stdout(sys.stderr):
        asyncio.run(serve(Path(profile), visible=visible))

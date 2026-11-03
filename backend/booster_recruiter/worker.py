"""One process per account: vendor singletons never cross account boundaries."""

from __future__ import annotations

import asyncio
import contextlib
import json
import os
import sys
import time
from pathlib import Path
from urllib.parse import urlencode

from .identity import PROFILE_JS, resolve_own_profile

SEARCH_JS = r"""() => {
 const main=document.querySelector('main'); if(!main)return [];
 const found=new Map();
 for(const a of main.querySelectorAll('a[href*="/in/"]')) {
  if(a.closest('aside,nav,header,footer'))continue;
  const u=new URL(a.href,location.href);
  if(!/(^|\.)linkedin\.com$/.test(u.hostname))continue;
  const match=u.pathname.match(/^\/in\/([^/]+)\/?$/);if(!match)continue;
  const label=(a.innerText||a.getAttribute('aria-label')||'').trim();
  if(!label)continue;
  found.set('https://www.linkedin.com/in/'+match[1],label.slice(0,200));
 }
 return Array.from(found,([url,label])=>({url,label}));
}"""


async def serve(profile: Path):
    from fastmcp import Client
    from booster_linkedin.bootstrap import configure_browser_environment
    from booster_linkedin.config import set_config
    from booster_linkedin.config.loaders import load_config
    from booster_linkedin.dependencies import get_ready_extractor
    from booster_linkedin.drivers.browser import get_or_create_browser
    from booster_linkedin.linkedin import photo_frame_detection
    from booster_linkedin.linkedin.session import PageSession
    from booster_linkedin.profile_claim import ensure_profile_claim
    from booster_linkedin.server import create_mcp_server

    from .ocr import detect

    args = [
        "--no-daemon",
        "--user-data-dir",
        str(profile),
        "--no-headless",
        "--no-auto-import",
        "--login-inline-wait",
        "5",
        "--browser-idle-timeout",
        "0",
    ]
    browser_path = os.environ.get("BOOSTER_BROWSER")
    if not browser_path:
        from patchright.async_api import async_playwright

        from .selftest import bundled_browsers

        bundled_browsers()
        if os.environ.get("PLAYWRIGHT_BROWSERS_PATH"):
            async with async_playwright() as playwright:
                browser_path = playwright.chromium.executable_path
            if not Path(browser_path).is_file():
                raise RuntimeError(
                    "Встроенный браузер не найден. Переустановите приложение."
                )
    if browser_path:
        args += ["--chrome-path", browser_path]
    set_config(load_config(args))
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
    last = 0.0
    async with Client(create_mcp_server(), timeout=240) as client:

        async def call(name, arguments):
            nonlocal last
            await asyncio.sleep(max(0, 7 - (time.monotonic() - last)))
            last = time.monotonic()
            result = await client.call_tool(name, arguments, raise_on_error=False)
            if result.is_error:
                meta = result.meta or {}
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
                if action == "login":
                    result, _ = await call("get_my_profile", {})
                    browser = await get_or_create_browser()
                    result = await resolve_own_profile(
                        PageSession(browser.page), result["url"]
                    )
                elif action == "search":
                    extractor = await get_ready_extractor(
                        None, tool_name="search_people"
                    )
                    url = (
                        "https://www.linkedin.com/search/results/people/?"
                        + urlencode(
                            {"keywords": p["keywords"], "page": int(p.get("page", 1))}
                        )
                    )
                    await asyncio.sleep(max(0, 7 - (time.monotonic() - last)))
                    last = time.monotonic()
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
                elif action == "send":
                    result, _ = await call(
                        "send_message",
                        {
                            "linkedin_username": p["url"],
                            "message": p["message"],
                            "confirm_send": True,
                        },
                    )
                elif action == "conversation":
                    result, _ = await call(
                        "get_conversation", {"linkedin_username": p["url"]}
                    )
                elif action == "close":
                    await call("close_session", {})
                    result = {"ok": True}
                else:
                    raise ValueError("Unknown worker command")
                payload = {"id": request["id"], "result": result}
            except Exception as exc:
                payload = {"id": request["id"], "error": str(exc)[:1800]}
            sys.__stdout__.write(json.dumps(payload, ensure_ascii=False) + "\n")
            sys.__stdout__.flush()
            if action == "close":
                break


def main(profile):
    # Browser setup and library progress may print. Reserve stdout for RPC.
    with contextlib.redirect_stdout(sys.stderr):
        asyncio.run(serve(Path(profile)))

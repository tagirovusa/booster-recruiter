"""Offline installation check. It never connects to LinkedIn."""

import asyncio
import io
import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path


def bundled_browsers():
    root = (
        Path(sys.executable).parent.parent
        if getattr(sys, "frozen", False)
        else Path(__file__).resolve().parents[2] / "runtime"
    )
    folder = root / "browser"
    if folder.is_dir():
        os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", str(folder))
    return folder


async def check():
    from fastmcp import Client
    from booster_linkedin.core.browser import BrowserManager
    from booster_linkedin.linkedin.session import PageSession
    from booster_linkedin.process_tree import (
        release_browser_guardian,
        release_nonce,
        start_browser_guardian,
        windows_gate_command,
    )
    from booster_linkedin.server import create_mcp_server
    from patchright.async_api import async_playwright
    from PIL import Image

    from .identity import IdentityResolutionError, resolve_own_profile
    from .ocr import detect
    from .outreach_browser_check import check_outreach_browser
    from .recruiter_browser_check import check_recruiter_browser
    from .send_confirmation_check import check_send_confirmation
    from .worker import PROFILE_JS, SEARCH_JS

    bundled_browsers()
    # Exercise the actual helper subprocess commands, not only raw Chromium.
    # This fails on the 0.1.0 frozen binary before any browser is opened.
    with tempfile.TemporaryFile() as lease:
        start_browser_guardian(lease.fileno())
        release_browser_guardian()
    nonce = release_nonce()
    target = [sys.executable, "--help"]
    gate = subprocess.run(
        windows_gate_command(target, nonce),
        input=f"release {nonce}\n".encode(),
        capture_output=True,
        timeout=30,
    )
    assert gate.returncode == 0 and gate.stdout, gate.stderr.decode(errors="replace")
    # Also exercises dynamic MCP imports in the frozen application.
    async with Client(create_mcp_server()) as client:
        names = {tool.name for tool in await client.list_tools()}
        assert {"get_my_profile", "get_person_profile", "send_message"} <= names
    async with async_playwright() as playwright:
        # Exercise the same manager/mode as background campaigns, including
        # persistence after a clean close. No account or LinkedIn request.
        with tempfile.TemporaryDirectory(prefix="booster-background-") as folder:
            for attempt in range(2):
                manager = BrowserManager(
                    folder,
                    headless=True,
                    native_headless=True,
                    executable_path=playwright.chromium.executable_path,
                )
                async with manager:
                    assert manager.headless and not manager._windowless
                    await manager.page.route("**/*", lambda route: route.abort())
                    await manager.page.set_content("<h1>Background browser check</h1>")
                    assert (
                        await manager.page.locator("h1").inner_text()
                        == "Background browser check"
                    )
                    if attempt == 0:
                        await manager.context.add_cookies(
                            [
                                {
                                    "name": "booster_test",
                                    "value": "persisted",
                                    "url": "https://booster.invalid",
                                    "expires": time.time() + 3600,
                                }
                            ]
                        )
                    else:
                        cookies = await manager.context.cookies(
                            "https://booster.invalid"
                        )
                        assert any(
                            c["name"] == "booster_test" and c["value"] == "persisted"
                            for c in cookies
                        )
                assert manager.close_confirmed
        browser = await playwright.chromium.launch(channel="chromium", headless=True)
        try:
            context = await browser.new_context()
            await context.route("**/*", lambda route: route.abort())
            page = await context.new_page()
            await page.route("**/*", lambda route: route.abort())
            await page.set_content("""<main><section><h1>Test Recruiter</h1>
                <p>Recruitment Manager</p><a href="https://www.linkedin.com/company/example">Example</a>
                <a href="https://www.linkedin.com/in/test-candidate/">Candidate</a></section>
                <aside><a href="https://www.linkedin.com/in/unrelated/">Unrelated</a></aside></main>""")
            person = await page.evaluate(PROFILE_JS)
            assert (
                person["name"] == "Test Recruiter"
                and person["headline"] == "Recruitment Manager"
            )
            await page.set_content("""<main><div data-sdui-screen="com.linkedin.sdui.flagshipnav.search.SearchResultsPeople">
              <div role="list"><div componentkey="SearchResults_FirstResult_people"><div role="listitem">
              <a tabindex="0" componentkey="candidate" href="https://www.linkedin.com/in/test-candidate/">Candidate</a>
              <a href="https://www.linkedin.com/in/mutual-person/">Mutual connection</a>
              </div></div></div></div><a href="https://www.linkedin.com/in/unrelated/">Unrelated</a></main>""")
            links = await page.evaluate(SEARCH_JS)
            assert len(links) == 1 and links[0]["url"].endswith("test-candidate")

            # Synthetic LinkedIn documents served entirely by route.fulfill:
            # exercise real Chromium timing, DOM metadata and the frozen worker's
            # resolver without contacting LinkedIn or using an account session.
            async def own_document(route):
                requested = route.request.url
                head = ""
                if "canonical-test" in requested:
                    head = '<link rel="canonical" href="https://www.linkedin.com/in/test-recruiter/">'
                elif "/in/me/" in requested and "unresolved-test" not in requested:
                    head = "<script>setTimeout(()=>location.replace('/in/test-recruiter/'), 100)</script>"
                await route.fulfill(
                    content_type="text/html",
                    body=f"""<html><head>{head}</head><body>
                    <main><section><h1>Test Recruiter</h1></section>
                    <aside><a href="/in/unrelated/">Unrelated</a></aside></main>
                    </body></html>""",
                )

            await page.route("**/*", own_document)
            alias = "https://www.linkedin.com/in/me/"
            session = PageSession(page)
            for query in ("", "?canonical-test=1"):
                await page.goto(alias + query)
                identity = await resolve_own_profile(session, alias, timeout=5)
                assert identity == {
                    "url": "https://www.linkedin.com/in/test-recruiter",
                    "name": "Test Recruiter",
                }
            await page.goto(alias + "?unresolved-test=1")
            try:
                await resolve_own_profile(session, alias, timeout=0.3)
            except IdentityResolutionError:
                pass
            else:
                raise AssertionError("Unresolved alias accepted as an account identity")
            send_cases = await check_send_confirmation(page)
            outreach_cases = await check_outreach_browser(page)
            recruiter_cases = await check_recruiter_browser(page)
        finally:
            await browser.close()
    png = io.BytesIO()
    Image.new("RGB", (128, 128), "green").save(png, format="PNG")
    assert detect(png.getvalue())["status"] == "unknown"
    return {
        "ok": True,
        "browser": "bundled Chromium",
        "ocr": "offline",
        "mcp_tools": len(names),
        "process_helpers": "verified",
        "own_profile_identity": "redirect, canonical and unresolved alias verified offline",
        "send_confirmation_dom_cases": send_cases,
        "outreach_dom_cases": outreach_cases,
        "recruiter_dom_cases": recruiter_cases,
        "native_background_browser": "rendering and persistent profile verified offline",
        "linkedin_accessed": False,
    }


def run():
    # Avoid writing vendor lifecycle state into a real account's directory.
    from booster_linkedin.config import set_config
    from booster_linkedin.config.loaders import load_config
    from booster_linkedin.profile_claim import ensure_profile_claim

    with tempfile.TemporaryDirectory(prefix="booster-check-") as folder:
        ensure_profile_claim(Path(folder) / "profile", claim_anyway=False)
        set_config(
            load_config(
                [
                    "--no-daemon",
                    "--user-data-dir",
                    str(Path(folder) / "profile"),
                    "--no-auto-import",
                ]
            )
        )
        print(json.dumps(asyncio.run(check())), flush=True)

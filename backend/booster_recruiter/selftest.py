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
    frozen = getattr(sys, "frozen", False)
    root = (
        Path(sys.executable).parent.parent
        if frozen
        else Path(__file__).resolve().parents[2] / "runtime"
    )
    folder = root / "browser"
    if frozen:
        if not folder.is_dir():
            raise RuntimeError(
                "Встроенный браузер не найден. Переустановите приложение."
            )
        # An installed app must never inherit another tool's browser cache.
        os.environ["PLAYWRIGHT_BROWSERS_PATH"] = str(folder)
    elif folder.is_dir():
        os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", str(folder))
    return folder


async def check():
    from booster_linkedin.core.browser import BrowserManager
    from booster_linkedin.linkedin.session import PageSession
    from booster_linkedin.process_tree import (
        release_browser_guardian,
        release_nonce,
        start_browser_guardian,
        windows_gate_command,
    )
    from booster_linkedin.server import create_mcp_server
    from fastmcp import Client
    from patchright.async_api import async_playwright as patchright_session
    from PIL import Image

    from .browser_engine import verify_browser_engine
    from .identity import IdentityResolutionError, resolve_own_profile
    from .ocr import detect
    from .outreach_browser_check import check_outreach_browser
    from .recruiter_browser_check import check_recruiter_browser
    from .send_confirmation_check import check_send_confirmation
    from .worker import PROFILE_JS, SEARCH_JS

    bundled_browsers()
    engine = verify_browser_engine()
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
    async with patchright_session() as patchright:
        # Exercise the same manager/mode as background campaigns, including
        # persistence after a clean close. No account or LinkedIn request.
        with tempfile.TemporaryDirectory(prefix="booster-background-") as folder:
            for attempt in range(2):
                manager = BrowserManager(
                    folder,
                    headless=True,
                    native_headless=True,
                    executable_path=patchright.chromium.executable_path,
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
        browser = await patchright.chromium.launch(channel="chromium", headless=True)
        try:
            assert browser.version == engine["chromium_version"], (
                "Running Chromium does not match the shipped Patchright browser."
            )
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
        "browser_engine": engine,
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
    from booster_linkedin.debug_trace import reset_trace_state_for_testing
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
        try:
            result = asyncio.run(check())
        finally:
            # Negative DOM fixtures may retain a trace and its .alive lease.
            # Close that lease before TemporaryDirectory removes the test data;
            # Windows refuses to delete the file while its descriptor is open.
            reset_trace_state_for_testing()
    print(json.dumps(result), flush=True)

import ast
import json
import os
import tomllib
from pathlib import Path

import httpx
import pytest
from booster_linkedin.core.browser import async_playwright as vendor_browser_factory
from booster_recruiter import browser_engine, selftest
from booster_recruiter.api import create_app
from booster_recruiter.runtime import Runtime
from booster_recruiter.store import Store
from patchright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[2]


def test_shipped_engine_matches_exact_lock_and_vendor_factory():
    info = browser_engine.verify_browser_engine()
    lock = tomllib.loads((ROOT / "uv.lock").read_text())
    package = next(p for p in lock["package"] if p["name"] == "patchright")
    vendor = tomllib.loads(
        (ROOT / "vendor/booster-linkedin/pyproject.toml").read_text()
    )
    assert info["version"] == package["version"] == browser_engine.PATCHRIGHT_VERSION
    assert f"patchright=={info['version']}" in vendor["project"]["dependencies"]
    assert info["driver"] == "patchright-core"
    assert info["chromium_version"] and info["chromium_revision"]
    assert vendor_browser_factory is async_playwright
    assert not any(p["name"] == "playwright" for p in lock["package"])


def test_browser_sources_cannot_import_stock_automation_engines():
    imports = []
    for folder in (
        ROOT / "backend/booster_recruiter",
        ROOT / "vendor/booster-linkedin/booster_linkedin",
    ):
        for source in folder.rglob("*.py"):
            # File-provider conflict copies are not valid Python modules.
            if not source.stem.isidentifier():
                continue
            for node in ast.walk(ast.parse(source.read_text(encoding="utf8"))):
                if isinstance(node, ast.Import):
                    imports.extend(alias.name for alias in node.names)
                elif isinstance(node, ast.ImportFrom) and node.module:
                    imports.append(node.module)
    assert not {name.split(".")[0] for name in imports} & {"playwright", "selenium"}


@pytest.mark.parametrize(
    "field,value", [("version", "0.0.0"), ("driver", "playwright-core")]
)
def test_wrong_engine_is_rejected_before_browser_start(monkeypatch, field, value):
    info = browser_engine.browser_engine_info() | {field: value}
    monkeypatch.setattr(browser_engine, "browser_engine_info", lambda: info)
    with pytest.raises(RuntimeError, match="движка"):
        browser_engine.verify_browser_engine()


def test_packaged_browser_overrides_an_inherited_cache(tmp_path, monkeypatch):
    executable = tmp_path / "runtime/booster-backend/booster-backend"
    browser = tmp_path / "runtime/browser"
    browser.mkdir(parents=True)
    monkeypatch.setattr(selftest.sys, "frozen", True, raising=False)
    monkeypatch.setattr(selftest.sys, "executable", str(executable))
    monkeypatch.setenv("PLAYWRIGHT_BROWSERS_PATH", str(tmp_path / "other-tool-cache"))
    assert selftest.bundled_browsers() == browser
    assert os.environ["PLAYWRIGHT_BROWSERS_PATH"] == str(browser)


def test_packaged_browser_does_not_fall_back_when_missing(tmp_path, monkeypatch):
    monkeypatch.setattr(selftest.sys, "frozen", True, raising=False)
    monkeypatch.setattr(
        selftest.sys, "executable", str(tmp_path / "runtime/backend/app")
    )
    monkeypatch.setenv("PLAYWRIGHT_BROWSERS_PATH", str(tmp_path / "other-tool-cache"))
    with pytest.raises(RuntimeError, match="Встроенный браузер не найден"):
        selftest.bundled_browsers()


async def test_local_diagnostics_expose_actual_engine_without_account_or_browser(
    tmp_path,
):
    store = Store(tmp_path)
    try:
        app = create_app(store, Runtime(store), "fixture-token")
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            response = await client.post(
                "/command",
                json={"op": "diagnostics"},
                headers={"Authorization": "Bearer fixture-token"},
            )
        assert response.status_code == 200
        result = response.json()["result"]
        assert result["accounts"] == result["active_jobs"] == 0
        assert result["browser_engine"] == browser_engine.verify_browser_engine()
        assert str(tmp_path) not in json.dumps(result)
    finally:
        store.db.close()

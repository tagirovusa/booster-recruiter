"""Report the shipped browser engine without opening a browser or an account."""

import json
from importlib.metadata import version
from pathlib import Path

import patchright

PATCHRIGHT_VERSION = "1.64.4"


def browser_engine_info():
    driver = Path(patchright.__file__).parent / "driver" / "package"
    package = json.loads((driver / "package.json").read_text(encoding="utf8"))
    browsers = json.loads((driver / "browsers.json").read_text(encoding="utf8"))
    chromium = next(b for b in browsers["browsers"] if b["name"] == "chromium")
    return {
        "name": "Patchright",
        "version": version("patchright"),
        "driver": package["name"],
        "driver_version": package["version"],
        "chromium_version": chromium["browserVersion"],
        "chromium_revision": chromium["revision"],
    }


def verify_browser_engine():
    info = browser_engine_info()
    if info["version"] != PATCHRIGHT_VERSION or info["driver"] != "patchright-core":
        raise RuntimeError(
            "Версия браузерного движка не соответствует сборке приложения. "
            "Переустановите приложение."
        )
    return info

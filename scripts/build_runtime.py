"""Build on the target OS. No developer tools are needed on the client PC."""

import importlib.metadata
import os
import shutil
import subprocess
import sys
import tomllib
from pathlib import Path

root = Path(__file__).resolve().parents[1]
# An old editable-build egg-info beside backend/ can shadow the installed
# distribution when PYTHONPATH includes that directory. It is generated build
# metadata, not source; never bundle a version left by an earlier release.
stale_metadata = root / "backend/booster_recruiter.egg-info"
if stale_metadata.is_dir():
    shutil.rmtree(stale_metadata)
expected_version = tomllib.loads((root / "pyproject.toml").read_text(encoding="utf-8"))["project"][
    "version"
]
if importlib.metadata.version("booster-recruiter") != expected_version:
    raise RuntimeError(
        "Installed package metadata is stale. Run uv sync --frozen before building."
    )
command = [
    sys.executable,
    "-m",
    "PyInstaller",
    "--noconfirm",
    "--clean",
    "--onedir",
    "--name",
    "booster-backend",
    "--paths",
    str(root / "backend"),
    "--distpath",
    str(root / "runtime"),
    "--workpath",
    str(root / "build/pyinstaller"),
    "--specpath",
    str(root / "build"),
]
for package in [
    "booster_recruiter",
    "booster_linkedin",
    "fastmcp",
    "patchright",
    "rapidocr_onnxruntime",
    "onnxruntime",
    "uvicorn",
    "tzdata",
]:
    command += ["--collect-all", package]
for distribution in ["booster-linkedin-runtime", "fastmcp", "mcp", "booster-recruiter"]:
    command += ["--copy-metadata", distribution]
command += [
    "--collect-data",
    "mcp",
    "--exclude-module",
    "mcp.cli",
    str(root / "scripts/entry.py"),
]
# Use the actual source tree for both collection helpers and module analysis.
# An editable-install .pth file can be ignored when the filesystem marks it
# hidden; packaging must not silently omit the application in that case.
build_env = {
    **os.environ,
    "PYTHONPATH": os.pathsep.join(
        filter(None, (str(root / "backend"), os.environ.get("PYTHONPATH")))
    ),
}
subprocess.run(command, cwd=root, env=build_env, check=True)
# Local wheel/editable-install provenance contains build-machine source paths.
# Runtime metadata and dependency notices remain available without these files.
for provenance in (root / "runtime/booster-backend").rglob(
    "*.dist-info/direct_url.json"
):
    provenance.unlink()
env = {**os.environ, "PLAYWRIGHT_BROWSERS_PATH": str(root / "runtime/browser")}
subprocess.run(
    [sys.executable, "-m", "patchright", "install", "chromium", "--no-shell"],
    env=env,
    cwd=root,
    check=True,
)

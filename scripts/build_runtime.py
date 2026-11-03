"""Build on the target OS. No developer tools are needed on the client PC."""

import os
import subprocess
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
command = [
    sys.executable,
    "-m",
    "PyInstaller",
    "--noconfirm",
    "--clean",
    "--onedir",
    "--name",
    "booster-backend",
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
subprocess.run(command, cwd=root, check=True)
env = {**os.environ, "PLAYWRIGHT_BROWSERS_PATH": str(root / "runtime/browser")}
subprocess.run(
    [sys.executable, "-m", "patchright", "install", "chromium", "--no-shell"],
    env=env,
    cwd=root,
    check=True,
)

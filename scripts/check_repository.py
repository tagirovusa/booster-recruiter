"""Reject private runtime files and machine-specific paths in tracked source."""

from __future__ import annotations

import re
import subprocess
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parents[1]
PRIVATE_DIRS = {
    ".auth", "accounts", "profiles", "profile", "runtime-profiles",
    "user-data", "exports", "traces", "test-results", "playwright-report",
}
PRIVATE_NAMES = {
    "connection.json", "source-state.json", "runtime-state.json",
    "profile-claim.json", "profile-claim.lock", "profile.lock", "profile.handoff",
    "login data", "web data", "cookies", "preferences", "local state",
}
PERSONAL_PATH = re.compile(
    rb"(?:/" rb"Users/(?!runner(?:/|\b))[^/\s]+/|"
    rb"/" rb"home/(?!runner/|pwuser/)[^/\s]+/|"
    rb"[A-Z]:\\(?:Users|Documents and Settings)\\[^\\\s]+\\)",
    re.I,
)


def violations(name: str, data: bytes) -> list[str]:
    path = PurePosixPath(name)
    filename = path.name.lower()
    reasons = []
    if PRIVATE_DIRS.intersection(part.lower() for part in path.parts[:-1]):
        reasons.append("runtime data directory")
    if (
        filename in PRIVATE_NAMES
        or filename.startswith(("cookies", "storage-state", "storage_state"))
        or re.search(r"\.(sqlite3?|db)(?:-|$)", filename)
        or filename.endswith((".pem", ".key", ".p12", ".pfx", ".log"))
        or (filename.startswith(".env") and filename != ".env.example")
    ):
        reasons.append("private runtime or credential file")
    if b"\0" not in data and PERSONAL_PATH.search(data):
        reasons.append("machine-specific home path")
    return reasons


def main() -> int:
    names = subprocess.check_output(
        ["git", "ls-files", "-z"], cwd=ROOT
    ).decode().split("\0")
    failures = []
    for name in filter(None, names):
        data = subprocess.check_output(["git", "show", f":{name}"], cwd=ROOT)
        failures.extend(f"{name}: {reason}" for reason in violations(name, data))
    if failures:
        print("Repository privacy check failed; values are intentionally omitted:")
        print("\n".join(failures))
        return 1
    print("PASS: tracked source excludes private runtime files and machine-specific paths.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

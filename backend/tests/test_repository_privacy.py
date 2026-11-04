"""The source boundary must reject sessions even under an unexpected parent."""

import importlib.util
from pathlib import Path

import pytest

spec = importlib.util.spec_from_file_location(
    "repository_privacy",
    Path(__file__).resolve().parents[2] / "scripts/check_repository.py",
)
privacy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(privacy)


@pytest.mark.parametrize(
    "name",
    [
        "backend/accounts/example/state.json",
        "vendor/component/profile/Default/Preferences",
        "evidence/storage-state.json",
        "nested/connection.json",
        "workspace.sqlite3-wal",
        "nested/.env.production",
        "runtime-profiles/example/state.json",
    ],
)
def test_runtime_artifacts_are_rejected_anywhere(name):
    assert privacy.violations(name, b"{}")


@pytest.mark.parametrize(
    "data",
    [
        ("/Users/" + "fictional-developer/project").encode(),
        ("/home/" + "fictional-developer/project").encode(),
        ("C:" + "\\Users\\" + "FictionalDeveloper\\project").encode(),
    ],
)
def test_machine_specific_home_paths_are_rejected(data):
    assert privacy.violations("README.md", data)


def test_code_about_sessions_and_ci_paths_are_allowed():
    assert not privacy.violations("backend/session_state.py", b"cookies = []")
    assert not privacy.violations("README.md", b"/Users/runner/work/project")
    assert not privacy.violations(".env.example", b"EXAMPLE=")

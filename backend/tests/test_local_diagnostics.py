import socket
import urllib.request
from pathlib import Path
from types import SimpleNamespace

import pytest
from booster_linkedin import error_diagnostics
from booster_linkedin.core import proxy_errors


@pytest.fixture
def local_notes(tmp_path, monkeypatch):
    profile = tmp_path / "profile"
    profile.mkdir()
    monkeypatch.setattr(error_diagnostics, "get_source_profile_dir", lambda: profile)
    monkeypatch.setattr(error_diagnostics, "get_runtime_id", lambda: "test-host")
    monkeypatch.setattr(error_diagnostics, "load_source_state", lambda *_: None)
    monkeypatch.setattr(error_diagnostics, "load_runtime_state", lambda *_: None)
    monkeypatch.setattr(error_diagnostics, "get_trace_dir", lambda: None)
    monkeypatch.setattr(error_diagnostics, "mark_trace_for_retention", lambda: None)
    monkeypatch.setattr(
        proxy_errors,
        "_browser_config",
        lambda: SimpleNamespace(proxy_username="user", proxy_password="fixture-secret"),
    )
    network_attempts = []

    def network_forbidden(*args, **kwargs):
        network_attempts.append(True)
        raise AssertionError("Diagnostics must stay local")

    monkeypatch.setattr(urllib.request, "urlopen", network_forbidden)
    monkeypatch.setattr(socket, "getaddrinfo", network_forbidden)
    monkeypatch.setattr(socket, "create_connection", network_forbidden)
    return profile, network_attempts


@pytest.mark.parametrize("trace_enabled", [False, True])
def test_synchronous_diagnostics_write_local_notes_without_network(
    local_notes, monkeypatch, trace_enabled
):
    profile, network_attempts = local_notes
    trace = profile.parent / "trace" if trace_enabled else None
    if trace:
        trace.mkdir()
        (trace / "server.log").write_text("Local fixture log", encoding="utf8")
        monkeypatch.setattr(
            error_diagnostics, "mark_trace_for_retention", lambda: trace
        )
    result = error_diagnostics.build_issue_diagnostics(
        RuntimeError("Connection failed: https://user:fixture-secret@example.invalid"),
        context="profile-read",
        target_url="https://www.linkedin.com/in/test-recipient",
        section_name="profile",
    )
    assert network_attempts == []
    assert result["existing_issues"] == []
    assert result["issue_search_skipped"] is True
    assert result["runtime"] == {
        "current_runtime_id": "test-host",
        "trace_dir": str(trace) if trace else None,
        "log_path": str(trace / "server.log") if trace else None,
        "suggested_gist_command": None,
    }
    note = Path(result["issue_template_path"])
    assert note.parent == (trace or profile.parent / "issue-reports")
    content = note.read_text(encoding="utf8")
    assert "Business Booster diagnostic notes" in content
    assert (
        "fixture-secret" not in content
        and "fixture-secret" not in result["error_message"]
    )
    assert "automatically" in content
    assert "Advisory open issues" not in content
    assert set(result) == {
        "created_at",
        "context",
        "section_name",
        "target_url",
        "error_type",
        "error_message",
        "suggested_issue_title",
        "existing_issues",
        "issue_search_skipped",
        "issue_template_path",
        "runtime",
    }


async def test_asynchronous_diagnostics_preserve_the_same_local_result(local_notes):
    profile, network_attempts = local_notes
    result = error_diagnostics.build_issue_diagnostics(
        RuntimeError("Profile could not be read"), context="profile-read"
    )
    assert network_attempts == []
    assert result["existing_issues"] == []
    assert result["issue_search_skipped"] is True
    assert (
        Path(result["issue_template_path"]).parent == profile.parent / "issue-reports"
    )
    assert result["target_url"] is None and result["section_name"] is None


def test_error_formatter_ignores_legacy_external_report_suggestions():
    result = error_diagnostics.format_tool_error_with_diagnostics(
        "Profile could not be read",
        {
            "issue_template_path": "local-report.md",
            "issue_search_skipped": False,
            "existing_issues": [
                {"number": 1, "title": "Legacy ticket", "url": "https://legacy.invalid"}
            ],
            "runtime": {
                "current_runtime_id": "test-host",
                "trace_dir": "local-trace",
                "log_path": "local-log",
                "suggested_gist_command": "upload-private-files",
            },
        },
    )
    assert "Business Booster" in result
    assert "local-report.md" in result and "local-log" in result
    assert "Legacy ticket" not in result and "https://" not in result
    assert "upload-private-files" not in result
    assert "packet" not in result.lower() and "skill" not in result.lower()

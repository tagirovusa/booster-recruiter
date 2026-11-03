# Adapted for Business Booster Recruiter.
"""Local diagnostic notes for Business Booster page-read failures."""

from __future__ import annotations

from dataclasses import asdict
import json
import socket
from pathlib import Path
from typing import Any

from booster_linkedin.common_utils import (
    secure_mkdir,
    secure_write_text,
    slugify_fragment,
    utcnow_iso,
)
from booster_linkedin.core.proxy_errors import redact_proxy_credentials
from booster_linkedin.debug_trace import get_trace_dir, mark_trace_for_retention
from booster_linkedin.session_state import (
    auth_root_dir,
    get_runtime_id,
    get_source_profile_dir,
    load_runtime_state,
    load_source_state,
    portable_cookie_path,
    runtime_profile_dir,
    runtime_storage_state_path,
)

ISSUE_TITLE_PREFIX = "[BUG]"
LOCAL_SUPPORT_GUIDANCE = (
    "Business Booster diagnostic notes stay on this computer. "
    "Review and remove account details before sharing a report with support. "
    "Files are never uploaded automatically."
)


def build_issue_diagnostics(
    exception: Exception,
    *,
    context: str,
    target_url: str | None = None,
    section_name: str | None = None,
) -> dict[str, Any]:
    """Write local evidence notes and return MCP-safe diagnostic locations."""
    timestamp = utcnow_iso()
    source_profile_dir = _safe_source_profile_dir()
    current_runtime_id = get_runtime_id()
    source_state = load_source_state(source_profile_dir)
    runtime_state = load_runtime_state(current_runtime_id, source_profile_dir)
    trace_dir = mark_trace_for_retention() or get_trace_dir()
    log_path = trace_dir / "server.log" if trace_dir else None
    issue_dir = trace_dir or (auth_root_dir(source_profile_dir) / "issue-reports")
    secure_mkdir(issue_dir)
    issue_path = (
        issue_dir
        / f"{timestamp.replace(':', '').replace('-', '')}-{slugify_fragment(context) or 'issue'}.md"
    )

    runtime_details = {
        "hostname": socket.gethostname(),
        "current_runtime_id": current_runtime_id,
        "source_profile_dir": str(source_profile_dir),
        "portable_cookie_path": str(portable_cookie_path(source_profile_dir)),
        "source_state": asdict(source_state) if source_state else None,
        "runtime_profile_dir": str(
            runtime_profile_dir(current_runtime_id, source_profile_dir)
        ),
        "runtime_storage_state_path": str(
            runtime_storage_state_path(current_runtime_id, source_profile_dir)
        ),
        "runtime_state": asdict(runtime_state) if runtime_state else None,
        "trace_dir": str(trace_dir) if trace_dir else None,
        "log_path": str(log_path) if log_path and log_path.exists() else None,
        "suggested_gist_command": None,
    }
    payload: dict[str, Any] = {
        "created_at": timestamp,
        "context": context,
        "section_name": section_name,
        "target_url": target_url,
        "error_type": type(exception).__name__,
        "error_message": redact_proxy_credentials(str(exception)),
        "runtime": runtime_details,
        "suggested_issue_title": _suggest_issue_title(
            context=context,
            section_name=section_name,
            target_url=target_url,
            current_runtime_id=current_runtime_id,
        ),
    }
    # Preserve the result shape consumed by existing error handlers. Diagnostic
    # generation is local in both synchronous and asynchronous entry points.
    payload["issue_search_skipped"] = True
    payload["existing_issues"] = []
    issue_template = _render_issue_template(payload)
    secure_write_text(issue_path, issue_template)
    return _public_issue_diagnostics(payload, issue_path=issue_path)


def format_tool_error_with_diagnostics(
    message: str, diagnostics: dict[str, Any]
) -> str:
    """Append local note locations and support guidance to a tool-facing error."""
    lines = [message, "", "Diagnostics:"]
    if diagnostics.get("issue_template_path"):
        lines.append(f"- Local diagnostic notes: {diagnostics['issue_template_path']}")
    runtime = diagnostics.get("runtime") or {}
    if runtime.get("trace_dir"):
        lines.append(f"- Local trace artifacts: {runtime['trace_dir']}")
    if runtime.get("log_path"):
        lines.append(f"- Local server log: {runtime['log_path']}")
    lines.append(f"- Runtime: {runtime.get('current_runtime_id', 'unknown')}")
    lines.append(LOCAL_SUPPORT_GUIDANCE)
    return "\n".join(lines)


def _render_issue_template(payload: dict[str, Any]) -> str:
    # Paths and session metadata are local troubleshooting aids, not a report
    # prepared for automatic sharing.
    runtime = payload["runtime"]
    return (
        "\n".join(
            [
                "# Business Booster diagnostic notes",
                "",
                LOCAL_SUPPORT_GUIDANCE,
                "",
                "## Captured failure",
                f"- Context: {payload['context']}",
                f"- Section: {payload.get('section_name') or 'n/a'}",
                f"- Target URL: {payload.get('target_url') or 'n/a'}",
                f"- Error: {payload['error_type']}: {payload['error_message']}",
                f"- Suggested title (local only): {payload['suggested_issue_title']}",
                "",
                "## Local runtime",
                f"- Hostname (local): {runtime['hostname']}",
                f"- Current runtime: {runtime['current_runtime_id']}",
                f"- Source profile (local): {runtime['source_profile_dir']}",
                f"- Portable cookies (local): {runtime['portable_cookie_path']}",
                f"- Derived runtime profile (local): {runtime['runtime_profile_dir']}",
                f"- Derived storage-state (local): {runtime['runtime_storage_state_path']}",
                f"- Trace artifacts (local): {runtime['trace_dir'] or 'not enabled'}",
                f"- Server log (local): {runtime['log_path'] or 'not enabled'}",
                "",
                "## Session state (local)",
                "```json",
                json.dumps(
                    {
                        "source_state": runtime["source_state"],
                        "runtime_state": runtime["runtime_state"],
                    },
                    indent=2,
                    sort_keys=True,
                ),
                "```",
            ]
        )
        + "\n"
    )


def _public_issue_diagnostics(
    payload: dict[str, Any], *, issue_path: Path
) -> dict[str, Any]:
    runtime = payload["runtime"]
    return {
        "created_at": payload["created_at"],
        "context": payload["context"],
        "section_name": payload["section_name"],
        "target_url": payload["target_url"],
        "error_type": payload["error_type"],
        "error_message": payload["error_message"],
        "suggested_issue_title": payload["suggested_issue_title"],
        "existing_issues": payload["existing_issues"],
        "issue_search_skipped": payload["issue_search_skipped"],
        "issue_template_path": str(issue_path),
        "runtime": {
            "current_runtime_id": runtime["current_runtime_id"],
            "trace_dir": runtime["trace_dir"],
            "log_path": runtime["log_path"],
            "suggested_gist_command": None,
        },
    }


def _safe_source_profile_dir():
    try:
        return get_source_profile_dir()
    except Exception:
        return (Path.home() / ".booster-recruiter" / "profile").expanduser()


def _suggest_issue_title(
    *,
    context: str,
    section_name: str | None,
    target_url: str | None,
    current_runtime_id: str,
) -> str:
    section = section_name or "unknown-section"
    route = target_url or context
    if "/recent-activity/" in route:
        summary = f"recent-activity redirect loop in {section} on {current_runtime_id}"
    else:
        summary = f"{section} read failure in {context} on {current_runtime_id}"
    return f"{ISSUE_TITLE_PREFIX} {summary}"

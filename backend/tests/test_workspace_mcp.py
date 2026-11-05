import io
import json

from booster_recruiter.mcp_bridge import create_server
from fastmcp import Client


async def test_workspace_mcp_tools_only_route_read_draft_and_backup_operations(
    tmp_path, monkeypatch
):
    (tmp_path / "connection.json").write_text(
        json.dumps({"port": 12345, "token": "test-local-token"})
    )
    calls = []

    def open_request(request, timeout):
        assert request.full_url == "http://127.0.0.1:12345/command"
        assert request.get_header("Authorization") == "Bearer test-local-token"
        value = json.loads(request.data)
        calls.append(value)
        return io.BytesIO(json.dumps({"result": {"ok": True}}).encode())

    monkeypatch.setattr("urllib.request.urlopen", open_request)
    async with Client(create_server(tmp_path)) as client:
        tools = {t.name: t for t in await client.list_tools()}
        assert len(tools) == 16
        assert not any(
            "restore" in t or "approve" == t or "send_message" in t for t in tools
        )
        assert tools["get_workspace_attention"].annotations.read_only_hint
        assert tools["list_campaign_templates"].annotations.read_only_hint
        for name, params in [
            ("get_workspace_attention", {}),
            ("list_campaign_templates", {}),
            (
                "create_campaign_from_template",
                {"template_id": "template", "account_id": "account", "name": "Fresh"},
            ),
            ("create_workspace_backup", {}),
            ("recheck_attention_item", {"item_id": "review:example"}),
        ]:
            result = await client.call_tool(name, params)
            assert result.structured_content == {"ok": True}
    assert [v["op"] for v in calls] == [
        "workspace.summary",
        "template.list",
        "template.create",
        "backup.create",
        "workspace.recheck",
    ]
    assert calls[2]["params"] == {
        "id": "template",
        "account_id": "account",
        "name": "Fresh",
    }

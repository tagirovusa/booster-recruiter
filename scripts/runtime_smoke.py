"""Exercise the built executable and its actual MCP stdio adapter, offline."""

import asyncio
import json
import os
import subprocess
import tempfile
import tomllib
import urllib.request
from pathlib import Path

from fastmcp import Client

root = Path(__file__).resolve().parents[1]
exe = (
    root
    / "runtime/booster-backend"
    / ("booster-backend.exe" if os.name == "nt" else "booster-backend")
)
assert not any(exe.parent.rglob("*.dist-info/direct_url.json")), (
    "Packaged runtime contains build-machine installation provenance."
)
subprocess.run([str(exe), "--self-test"], check=True, timeout=120)


async def check():
    with tempfile.TemporaryDirectory(prefix="booster-runtime-") as data:
        with tempfile.TemporaryFile() as log:
            process = subprocess.Popen(
                [str(exe), "--data-dir", data],
                stdout=subprocess.PIPE,
                stderr=log,
                text=True,
            )
            try:
                line = await asyncio.wait_for(
                    asyncio.to_thread(process.stdout.readline), 45
                )
                if not line:
                    log.seek(0)
                    raise RuntimeError(log.read().decode(errors="replace")[-4000:])
                connection = json.loads(line)
                request = urllib.request.Request(
                    f"http://127.0.0.1:{connection['port']}/command",
                    data=b'{"op":"diagnostics"}',
                    headers={
                        "Authorization": "Bearer " + connection["token"],
                        "Content-Type": "application/json",
                    },
                )
                response = json.load(urllib.request.urlopen(request, timeout=15))
                assert response["result"]["accounts"] == 0
                assert (
                    response["result"]["version"]
                    == json.loads((root / "package.json").read_text())["version"]
                ), "Frozen runtime version does not match the desktop release"
                locked_engine = next(
                    package["version"]
                    for package in tomllib.loads((root / "uv.lock").read_text())[
                        "package"
                    ]
                    if package["name"] == "patchright"
                )
                engine = response["result"]["browser_engine"]
                assert engine["name"] == "Patchright"
                assert engine["version"] == locked_engine
                assert engine["driver"] == "patchright-core"
                async with Client(
                    {
                        "mcpServers": {
                            "booster": {
                                "command": str(exe),
                                "args": ["--mcp", "--data-dir", data],
                            }
                        }
                    }
                ) as client:
                    tools = {t.name for t in await client.list_tools()}
                    assert (
                        "list_workspace" in tools and "resume_approved_batch" in tools
                    )
                    assert not any("approve" == t or "send_message" in t for t in tools)
                    assert len(tools) == 17
                    assert {
                        "get_workspace_attention",
                        "list_campaign_templates",
                        "create_campaign_from_template",
                        "create_workspace_backup",
                    } <= tools
                    assert not any("restore" in name for name in tools)
                    attention = await client.call_tool("get_workspace_attention", {})
                    assert attention.structured_content["counts"] == {
                        "reply": 0,
                        "login": 0,
                        "review": 0,
                    }
                    templates = await client.call_tool("list_campaign_templates", {})
                    assert templates.structured_content["templates"] == []
                    saved_backup = await client.call_tool("create_workspace_backup", {})
                    assert saved_backup.structured_content["bytes"] > 0
                    assert {
                        "configure_outreach",
                        "check_connections",
                        "preview_outreach",
                        "resume_approved_outreach",
                    } <= tools
                    state = await client.call_tool("list_workspace", {})
                    assert state.structured_content["accounts"] == []
                    # Exercise real draft mutations over MCP without connecting
                    # an account or authorizing any LinkedIn action.
                    seed = urllib.request.Request(
                        f"http://127.0.0.1:{connection['port']}/command",
                        data=json.dumps(
                            {
                                "op": "account.create",
                                "params": {"label": "Offline MCP test"},
                            }
                        ).encode(),
                        headers={
                            "Authorization": "Bearer " + connection["token"],
                            "Content-Type": "application/json",
                        },
                    )
                    account = json.load(urllib.request.urlopen(seed, timeout=15))[
                        "result"
                    ]
                    draft = await client.call_tool(
                        "create_campaign",
                        {
                            "account_id": account["id"],
                            "name": "Offline plan",
                            "keywords": "test",
                        },
                    )
                    cid = draft.structured_content["id"]
                    settings = await client.call_tool(
                        "configure_outreach",
                        {
                            "campaign_id": cid,
                            "rules": {
                                "allow_inmail": False,
                                "timezone": "Asia/Tbilisi",
                            },
                        },
                    )
                    assert settings.structured_content["strategy"] == "economy"
                    detail = await client.call_tool(
                        "get_campaign", {"campaign_id": cid}
                    )
                    assert (
                        detail.structured_content["outreach"]["rules"]["timezone"]
                        == "Asia/Tbilisi"
                    )
                    assert detail.structured_content["outreach"]["runs"] == []
                    save_template = urllib.request.Request(
                        f"http://127.0.0.1:{connection['port']}/command",
                        data=json.dumps(
                            {
                                "op": "template.save",
                                "params": {
                                    "campaign_id": cid,
                                    "name": "Offline reusable setup",
                                },
                            }
                        ).encode(),
                        headers={
                            "Authorization": "Bearer " + connection["token"],
                            "Content-Type": "application/json",
                        },
                    )
                    reusable = json.load(
                        urllib.request.urlopen(save_template, timeout=15)
                    )["result"]
                    fresh = await client.call_tool(
                        "create_campaign_from_template",
                        {
                            "template_id": reusable["id"],
                            "account_id": account["id"],
                            "name": "Fresh offline draft",
                        },
                    )
                    fresh_detail = await client.call_tool(
                        "get_campaign", {"campaign_id": fresh.structured_content["id"]}
                    )
                    assert (
                        fresh_detail.structured_content["campaign"]["status"] == "draft"
                    )
                    assert fresh_detail.structured_content["candidates"] == []
                    assert fresh_detail.structured_content["outreach"]["runs"] == []

                print(
                    "PASS: frozen executable, local authenticated API, 17 MCP tools, draft create/configure/read roundtrip and shared workspace; no LinkedIn requests."
                )
            finally:
                process.terminate()
                try:
                    process.wait(timeout=15)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()


asyncio.run(check())

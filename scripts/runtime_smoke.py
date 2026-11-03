"""Exercise the built executable and its actual MCP stdio adapter, offline."""

import asyncio
import json
import os
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path
from fastmcp import Client

root = Path(__file__).resolve().parents[1]
exe = (
    root
    / "runtime/booster-backend"
    / ("booster-backend.exe" if os.name == "nt" else "booster-backend")
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
                    state = await client.call_tool("list_workspace", {})
                    assert state.structured_content["accounts"] == []
                print(
                    "PASS: frozen executable, local authenticated API, MCP stdio tools and shared workspace; no LinkedIn requests."
                )
            finally:
                process.terminate()
                try:
                    process.wait(timeout=15)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()


asyncio.run(check())

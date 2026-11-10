import httpx
from booster_recruiter.api import create_app
from booster_recruiter.runtime import Runtime
from booster_recruiter.store import Store


async def test_api_rejects_unauthenticated_and_browser_origin_requests(tmp_path):
    store = Store(tmp_path)
    app = create_app(store, Runtime(store), "secret")
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        assert (await client.post("/command", json={"op": "state"})).status_code == 401
        assert (
            await client.post(
                "/command",
                json={"op": "state"},
                headers={
                    "Authorization": "Bearer secret",
                    "Origin": "https://untrusted.example",
                },
            )
        ).status_code == 403
        response = await client.post(
            "/command", json={"op": "state"}, headers={"Authorization": "Bearer secret"}
        )
        assert response.status_code == 200
        assert response.json()["result"]["accounts"] == []
    store.db.close()


async def test_agent_token_cannot_approve_sending_or_delete(tmp_path):
    """Only the desktop window confirms sending, deleting and restoring."""
    store = Store(tmp_path)
    app = create_app(store, Runtime(store), "agent", "desktop")
    try:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:

            async def call(token, op, params=None):
                return await client.post(
                    "/command",
                    json={"op": op, "params": params or {}},
                    headers={"Authorization": "Bearer " + token},
                )

            for op in (
                "outreach.approve",
                "backup.restore",
                "account.delete",
                "campaign.delete",
            ):
                refused = await call("agent", op, {"id": "x", "confirm": True})
                assert refused.status_code == 403
                assert "окне Booster Recruiter" in refused.json()["error"]
            assert (await call("agent", "state")).status_code == 200
            assert (await call("desktop", "state")).status_code == 200
            # The desktop token reaches the operation itself.
            desktop = await call("desktop", "campaign.delete", {"id": "x"})
            assert desktop.status_code == 400
            assert (await call("wrong", "state")).status_code == 401
    finally:
        store.db.close()


async def test_agent_token_cannot_resume_plans_or_resolve_sends(tmp_path):
    """Resuming starts real sends; resolving drops the duplicate-send guard."""
    store = Store(tmp_path)
    app = create_app(store, Runtime(store), "agent", "desktop")
    ops = {
        "outreach.resume": {"id": "x"},
        "outreach.check_now": {"id": "x"},
        "outreach.resolve": {"id": "x", "confirmed": False},
        "delivery.resolve": {"id": "x", "status": "blocked"},
    }
    try:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:

            async def call(token, op, params):
                return await client.post(
                    "/command",
                    json={"op": op, "params": params},
                    headers={"Authorization": "Bearer " + token},
                )

            for op, params in ops.items():
                refused = await call("agent", op, params)
                assert refused.status_code == 403, op
                assert refused.json()["error"] == (
                    "Это действие подтверждается только в окне Booster Recruiter."
                )
                # The desktop window reaches the operation itself; the made-up
                # id is then rejected by the operation, not by the token gate.
                desktop = await call("desktop", op, params)
                assert desktop.status_code not in (401, 403), op
    finally:
        store.db.close()

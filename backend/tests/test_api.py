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

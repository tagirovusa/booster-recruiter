import json
from types import SimpleNamespace

from booster_recruiter.runtime import Runtime, Worker
from booster_recruiter.store import Store
from test_store import prepared


async def test_worker_closes_previous_mode_before_reusing_profile(
    tmp_path, monkeypatch
):
    events, processes = [], []

    class Process:
        def __init__(self, visible):
            self.visible, self.returncode = visible, None
            self.stdin = self.stdout = self

        def write(self, line):
            self.request = json.loads(line)

        async def drain(self):
            pass

        async def readline(self):
            return (
                json.dumps(
                    {"id": self.request["id"], "result": {"visible": self.visible}}
                ).encode()
                + b"\n"
            )

        def close(self):
            events.append(("close", self.visible))
            self.returncode = 0

        async def wait(self):
            assert self.returncode == 0
            events.append(("exited", self.visible))
            return 0

    async def spawn(*args, **kwargs):
        assert all(p.returncode == 0 for p in processes)
        visible = "--browser-visible" in args
        process = Process(visible)
        processes.append(process)
        events.append(("start", visible))
        return process

    monkeypatch.setattr(
        "booster_recruiter.runtime.asyncio.create_subprocess_exec", spawn
    )
    worker = Worker(tmp_path, "test-account")
    assert not (await worker.call("login"))["visible"]
    assert not (await worker.call("search", {"keywords": "test"}))["visible"]
    assert len(processes) == 1
    assert (await worker.call("login", {"interactive": True}))["visible"]
    assert (await worker.call("open_profile", {"url": "test"}))["visible"]
    assert len(processes) == 2
    assert not (await worker.call("observe", {"url": "test"}))["visible"]
    assert events == [
        ("start", False),
        ("close", False),
        ("exited", False),
        ("start", True),
        ("close", True),
        ("exited", True),
        ("start", False),
    ]
    await worker.stop()


async def test_background_verification_and_manual_login_use_distinct_modes(tmp_path):
    calls = []

    class FakeWorker:
        def __init__(self, *args):
            pass

        async def call(self, action, params=None):
            calls.append((action, params))
            return {"url": "https://www.linkedin.com/in/recruiter", "name": "Recruiter"}

    store = Store(tmp_path)
    account, _, _ = prepared(store)
    runtime = Runtime(store, FakeWorker)
    try:
        await runtime.login(account["id"])
        await runtime.verify(account["id"])
        await runtime.verify(account["id"], interactive=True)
        assert calls == [
            ("login", {"interactive": True}),
            ("login", {"interactive": False}),
            ("login", {"interactive": True}),
        ]
    finally:
        store.db.close()


def test_native_headless_does_not_create_a_mac_hidden_target(tmp_path, monkeypatch):
    from booster_linkedin.core.browser import BrowserManager

    monkeypatch.setattr(
        "booster_linkedin.core.browser.hidden_target_is_supported", lambda: True
    )
    hidden = BrowserManager(tmp_path, headless=True, native_headless=True)
    visible = BrowserManager(tmp_path, headless=False, native_headless=True)
    assert not hidden._windowless and hidden._geometry()["viewport"]
    assert not visible._windowless and visible._geometry() == {"no_viewport": True}


def test_configured_native_mode_reaches_actual_browser(tmp_path, monkeypatch):
    from booster_linkedin.drivers import browser

    monkeypatch.setattr(
        browser,
        "get_config",
        lambda: SimpleNamespace(
            browser=SimpleNamespace(native_headless=True, slow_mo=0)
        ),
    )
    monkeypatch.setattr(browser, "_headless", True)
    manager = browser._make_browser(
        tmp_path, launch_options={}, viewport={"width": 1280, "height": 720}
    )
    assert manager.headless and manager.native_headless and not manager._windowless

from types import SimpleNamespace
from unittest.mock import AsyncMock

from booster_recruiter.outreach import DEFAULT_RULES, route
from booster_recruiter.outreach_browser import (
    PROFILE_CONTACT_JS,
    BrowserOutreach,
    InviteOnly,
)
from booster_linkedin.linkedin.connection import ActionSignals


async def test_missing_composer_allows_invite_but_never_message(monkeypatch):
    url = "https://www.linkedin.com/in/recipient"
    compose = "https://www.linkedin.com/messaging/compose/?recipient=ACoATest"
    page = SimpleNamespace(url=compose, wait_for_selector=AsyncMock())
    outreach = BrowserOutreach(page)
    outreach.navigator = SimpleNamespace(_navigate_to_page=AsyncMock())
    outreach.session = SimpleNamespace(check_rate_limit=AsyncMock())
    target = SimpleNamespace(
        profile_path="/in/recipient", profile_urn="ACoATest", compose_url=compose
    )
    outreach.sender._read_profile_message_target = AsyncMock(
        return_value=SimpleNamespace(target=target)
    )
    outreach.sender._wait_for_message_composer = AsyncMock(return_value=False)

    async def inspect(script, *args):
        if script == PROFILE_CONTACT_JS:
            return {
                "identity_verified": True,
                "relationship": "not_connected",
                "can_invite": True,
            }
        return {"verified": False}

    outreach.session.run_on_linkedin = inspect
    monkeypatch.setattr(
        "booster_recruiter.outreach_browser.InviteOnly._read_action_signals",
        AsyncMock(return_value=SimpleNamespace(has_incoming_action_row=False)),
    )
    observation = await outreach.observe(url, check_history=True)
    assert observation["identity_verified"]
    assert not observation["history_verified"]
    assert route(DEFAULT_RULES, observation)[0] == "invite"
    assert (await outreach.send(url, "Approved test"))["sent"] is False
    outreach.sender._wait_for_message_composer.reset_mock()
    await outreach.observe(url, relationship_only=True)
    outreach.sender._wait_for_message_composer.assert_not_awaited()


async def test_message_button_does_not_hide_invite_inside_more(monkeypatch):
    signals = ActionSignals(False, True, False, False, False, False)
    with_invite = ActionSignals(True, True, False, False, False, False)
    monkeypatch.setattr(
        "booster_linkedin.linkedin.connection_actions.ConnectionActions._read_action_signals",
        AsyncMock(side_effect=[signals, with_invite]),
    )
    connector = InviteOnly(None, None, None)
    connector._open_more_menu = AsyncMock()
    assert (await connector._read_action_signals("recipient")).has_invite_anchor
    connector._open_more_menu.assert_awaited_once()

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from booster_recruiter.outreach import DEFAULT_RULES, route
from booster_recruiter.outreach_browser import (
    PROFILE_CONTACT_JS,
    BrowserOutreach,
    InviteOnly,
)
from booster_linkedin.linkedin.connection import ActionSignals
from booster_linkedin.linkedin.connection_actions import ConnectionActions


@pytest.mark.parametrize("identifier", ["recipient", "julija-ambrazien%C4%97"])
async def test_missing_composer_allows_invite_but_never_message(
    monkeypatch, identifier
):
    url = "https://www.linkedin.com/in/" + identifier
    compose = "https://www.linkedin.com/messaging/compose/?recipient=ACoATest"
    page = SimpleNamespace(url=compose, wait_for_selector=AsyncMock())
    outreach = BrowserOutreach(page)
    outreach.navigator = SimpleNamespace(_navigate_to_page=AsyncMock())
    outreach.session = SimpleNamespace(check_rate_limit=AsyncMock())
    target = SimpleNamespace(
        profile_path="/in/" + identifier, profile_urn="ACoATest", compose_url=compose
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
    outreach.sender._wait_for_message_composer.assert_awaited_once()
    assert (await outreach.send(url, "Approved test"))["sent"] is False
    outreach.sender._wait_for_message_composer.reset_mock()
    await outreach.observe(url, relationship_only=True)
    outreach.sender._wait_for_message_composer.assert_not_awaited()


async def test_message_button_does_not_hide_invite_inside_more():
    session = SimpleNamespace(
        run_on_linkedin=AsyncMock(
            side_effect=[
                {
                    "identity_verified": True,
                    "relationship": "unknown",
                    "can_invite": False,
                },
                {
                    "identity_verified": True,
                    "relationship": "not_connected",
                    "can_invite": True,
                },
            ]
        )
    )
    connector = InviteOnly(session, None, None)
    connector._open_more_menu = AsyncMock()
    assert (await connector._read_action_signals("recipient")).has_invite_anchor
    connector._open_more_menu.assert_awaited_once()


async def test_unverified_page_cannot_reveal_or_send_invitation():
    session = SimpleNamespace(
        run_on_linkedin=AsyncMock(return_value={"identity_verified": False})
    )
    connector = InviteOnly(session, None, None)
    connector._open_more_menu = AsyncMock()
    assert await connector._read_action_signals("recipient") == ActionSignals(
        False, False, False, False, False, False
    )
    connector._open_more_menu.assert_not_awaited()


async def test_lost_invitation_response_is_unknown_and_never_retried(monkeypatch):
    attempts = []

    async def lost_response(self, *args, **kwargs):
        self._booster_invite_attempted = True
        attempts.append(True)
        raise RuntimeError("Browser response lost after dispatch")

    monkeypatch.setattr(ConnectionActions, "connect_with_person", lost_response)
    result = await InviteOnly(None, None, None).connect_with_person("recipient")
    assert result["status"] == "outcome_unknown" and len(attempts) == 1


async def test_browser_outreach_never_retries_unknown_invitation(monkeypatch):
    outreach = BrowserOutreach(SimpleNamespace())
    outreach.read_profile = AsyncMock()
    outreach.observe = AsyncMock(
        return_value={"identity_verified": True, "can_invite": True}
    )
    call = AsyncMock(return_value={"status": "outcome_unknown"})
    monkeypatch.setattr(InviteOnly, "connect_with_person", call)
    result = await outreach.invite("https://www.linkedin.com/in/recipient", "")
    assert result["invited"] is False and result["retry_safe"] is False
    call.assert_awaited_once()


@pytest.mark.parametrize("case", ["empty", "reply", "wrong_thread", "reader_error"])
async def test_compose_history_falls_back_to_exact_conversation(monkeypatch, case):
    from booster_recruiter.outreach_browser import COMPOSER_JS, THREAD_JS

    compose = "https://www.linkedin.com/messaging/compose/?recipient=ACoATest"
    page = SimpleNamespace(url=compose, wait_for_selector=AsyncMock())
    reader = AsyncMock()
    if case == "reader_error":
        reader.side_effect = RuntimeError("Conversation could not be verified")
    outreach = BrowserOutreach(page, read_conversation=reader)
    outreach.navigator = SimpleNamespace(_navigate_to_page=AsyncMock())
    outreach.session = SimpleNamespace(check_rate_limit=AsyncMock())
    target = SimpleNamespace(
        profile_path="/in/recipient", profile_urn="ACoATest", compose_url=compose
    )
    outreach.sender._read_profile_message_target = AsyncMock(
        return_value=SimpleNamespace(target=target)
    )
    outreach.sender._wait_for_message_composer = AsyncMock(return_value=True)
    outreach.sender._read_message_composer_state = AsyncMock(
        return_value={"status": "valid", "empty": True}
    )
    thread_reads = 0

    async def inspect(script, *args):
        nonlocal thread_reads
        if script == PROFILE_CONTACT_JS:
            return {
                "identity_verified": True,
                "relationship": "connected",
                "can_invite": False,
            }
        if script == COMPOSER_JS:
            return {"free": True, "paid": False, "credits": None}
        if script == THREAD_JS:
            thread_reads += 1
            if thread_reads == 2 and case == "reply":
                return {
                    "verified": True,
                    "has_reply": True,
                    "has_outgoing": True,
                    "reply_text": "Approved test reply",
                }
            return {"verified": False}
        return case == "empty"

    outreach.session.run_on_linkedin = inspect
    monkeypatch.setattr(
        "booster_recruiter.outreach_browser.InviteOnly._read_action_signals",
        AsyncMock(return_value=SimpleNamespace(has_incoming_action_row=False)),
    )
    if case == "reader_error":
        with pytest.raises(RuntimeError):
            await outreach.observe(
                "https://www.linkedin.com/in/recipient", check_history=True
            )
    else:
        result = await outreach.observe(
            "https://www.linkedin.com/in/recipient", check_history=True
        )
        assert result["history_verified"] is (case in ["empty", "reply"])
        assert result["free_message"] is (case in ["empty", "reply"])
        assert bool(result.get("has_reply")) is (case == "reply")
        if case == "reply":
            assert result["reply_text"] == "Approved test reply"
    if case == "empty":
        reader.assert_not_awaited()
    else:
        reader.assert_awaited_once_with(
            {"linkedin_username": "https://www.linkedin.com/in/recipient"}
        )

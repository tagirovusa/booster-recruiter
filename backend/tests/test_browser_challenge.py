"""A browser challenge stops a sender without erasing delivery evidence."""

import pytest
from booster_linkedin.core.exceptions import (
    AccountRestrictedError,
    AuthenticationError,
    RateLimitError,
)
from booster_recruiter.platform_limits import (
    LinkedInAccountRestrictedError,
    LinkedInChallengeError,
    LinkedInLimitError,
    check_after_browser_action,
)
from booster_recruiter.store import Store
from test_outreach import activate
from test_outreach_acceptance import additional_outreach


@pytest.fixture
def scenario(tmp_path):
    store = Store(tmp_path)
    account, campaign, person, plan, runtime, worker = activate(store, strategy="fast")
    twin = store.create_account("Same sender, second slot")
    store.set_account(twin["id"], "ready", store.account(account["id"])["url"])
    other_campaign, other = additional_outreach(
        store, twin["id"], plan["rules"], "other"
    )
    independent = store.create_account("Independent sender")
    store.set_account(independent["id"], "ready", "independent-sender")
    _, independent_plan = additional_outreach(
        store, independent["id"], plan["rules"], "independent"
    )
    yield {
        "store": store,
        "account": account,
        "campaign": campaign,
        "person": person,
        "plan": plan,
        "runtime": runtime,
        "worker": worker,
        "twin": twin,
        "other_campaign": other_campaign,
        "other": other,
        "independent": independent,
        "independent_plan": independent_plan,
    }
    store.db.close()


def assert_sender_paused(scenario):
    s = scenario
    store = s["store"]
    for key in ("account", "twin"):
        assert store.account(s[key]["id"])["status"] == "needs_login"
    for key in ("plan", "other"):
        assert store.outreach.run(s[key]["run_id"])["status"] == "paused"
    assert store.campaign(s["other_campaign"]["id"])["status"] == "paused"
    assert s["other_campaign"]["id"] in s["runtime"].pause_flags
    assert store.account(s["independent"]["id"])["status"] == "ready"
    assert store.outreach.run(s["independent_plan"]["run_id"])["status"] == "active"


@pytest.mark.parametrize(
    "action", ["login", "search", "profile", "observe", "open_profile"]
)
async def test_challenge_during_read_stops_every_slot_of_the_sender(scenario, action):
    s = scenario
    worker = s["worker"]
    original = worker.call
    calls = []

    async def call(operation, params=None):
        calls.append(operation)
        if operation == action:
            raise LinkedInChallengeError("Complete captcha checkpoint")
        if operation == "search":
            return {"profiles": [{"url": "https://www.linkedin.com/in/new-recipient"}]}
        return await original(operation, params)

    worker.call = call
    if action == "observe":
        await s["runtime"].outreach.check(s["campaign"]["id"])
    elif action == "open_profile":
        with pytest.raises(LinkedInChallengeError):
            await s["runtime"].open_profile(s["account"]["id"], s["person"]["url"])
    else:
        await s["runtime"].collect(s["campaign"]["id"])
    assert calls[-1] == action
    assert_sender_paused(s)
    assert not worker.actions
    assert not s["store"].rows("SELECT * FROM outreach_actions")
    before = calls.copy()
    await s["runtime"].outreach.process(s["other"]["run_id"])
    assert calls == before


@pytest.mark.parametrize("kind", ["invite", "send_free", "send_inmail"])
@pytest.mark.parametrize("confirmed", [True, False, None])
async def test_outgoing_challenge_preserves_result_and_stops_sender(
    scenario, kind, confirmed
):
    s = scenario
    worker = s["worker"]
    if kind == "invite":
        worker.observation.update(inmail=False)
    elif kind == "send_free":
        worker.observation.update(free_message=True)
    original = worker.call

    async def call(action, params=None):
        result = await original(action, params)
        if action == kind:
            return {
                "invited": confirmed if kind == "invite" else False,
                "sent": confirmed if kind != "invite" else False,
                "retry_safe": confirmed is False,
                "auth_required": True,
                "message": "Complete captcha checkpoint",
            }
        return result

    worker.call = call
    await s["runtime"].outreach.process(s["plan"]["run_id"])
    assert_sender_paused(s)
    expected = "sent" if confirmed else "blocked" if confirmed is False else "unknown"
    assert s["store"].rows("SELECT status FROM outreach_actions") == [
        {"status": expected}
    ]
    await s["runtime"].outreach.process(s["other"]["run_id"])
    assert len(worker.actions) == 1


@pytest.mark.parametrize(
    ("browser_error", "public_error", "flag"),
    [
        (AuthenticationError, LinkedInChallengeError, "auth_required"),
        (AccountRestrictedError, LinkedInAccountRestrictedError, "account_restricted"),
        (RateLimitError, LinkedInLimitError, "platform_limited"),
    ],
)
@pytest.mark.parametrize("outgoing", [False, True])
async def test_post_action_check_returns_flags_only_for_outgoing(
    browser_error, public_error, flag, outgoing
):
    class Session:
        async def check_rate_limit(self):
            raise browser_error("Platform stopped the operation")

    result = {"sent": True, "thread_id": "verified-thread", "credit_cost": 1}
    if outgoing:
        checked = await check_after_browser_action(Session(), result, outgoing=True)
        assert checked[flag] is True
        assert all(checked[key] == value for key, value in result.items())
        assert flag not in result
    else:
        with pytest.raises(public_error):
            await check_after_browser_action(Session(), result)


@pytest.mark.parametrize(
    ("browser_error", "flag"),
    [
        (AuthenticationError, "auth_required"),
        (AccountRestrictedError, "account_restricted"),
        (RateLimitError, "platform_limited"),
    ],
)
async def test_before_submit_rechecks_challenge_after_pause(browser_error, flag):
    from booster_recruiter.platform_limits import before_submit_guard

    calls = []

    class Pacer:
        async def before_submit(self):
            calls.append("pause")

    class Session:
        async def check_rate_limit(self):
            assert calls == ["pause"]
            calls.append("check")
            raise browser_error("Changed during the pause")

    result = await before_submit_guard(Session(), Pacer())
    assert result[flag] is True
    assert calls == ["pause", "check"]


async def test_before_submit_does_not_classify_transport_failure_as_safe_refusal():
    from booster_recruiter.platform_limits import before_submit_guard

    class Session:
        async def check_rate_limit(self):
            raise ConnectionError("Browser disconnected")

    with pytest.raises(ConnectionError):
        await before_submit_guard(Session())

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from booster_recruiter.recruiter_browser import RecruiterBrowser


@pytest.mark.parametrize(
    "change,confirmed",
    [
        ({}, True),
        ({"body": "Different message"}, False),
        ({"subject": "Different subject"}, False),
        ({"sender": "from Another recruiter"}, False),
        ({"state": "Scheduled"}, False),
        ({"state": "Failed"}, False),
        ({"state": ""}, False),
    ],
)
async def test_confirm_requires_exact_persisted_message(change, confirmed):
    adapter = RecruiterBrowser(
        SimpleNamespace(wait_for_timeout=AsyncMock()), None, None
    )
    row = {
        "body": "Approved body\n\nRecruiter",
        "subject": "Approved subject",
        "sender": "from Recruiter",
        "state": "Pending",
        "thread_id": "recruiter:verified-thread",
    } | change
    adapter.history = AsyncMock(return_value=[row])
    result = await adapter.confirm(
        {},
        {"sender_name": "Recruiter"},
        "Approved body\n\nRecruiter",
        "Approved subject",
    )
    assert result is confirmed
    assert adapter.confirmed_thread == (row["thread_id"] if confirmed else None)


async def test_confirm_polls_history_without_resubmitting():
    adapter = RecruiterBrowser(
        SimpleNamespace(wait_for_timeout=AsyncMock()), None, None
    )
    row = {
        "body": "Approved body",
        "subject": "Approved subject",
        "sender": "from Recruiter",
        "state": "Pending",
        "thread_id": "recruiter:verified-thread",
    }
    adapter.history = AsyncMock(side_effect=[[], [], [row]])
    assert await adapter.confirm(
        {}, {"sender_name": "Recruiter"}, "Approved body", "Approved subject"
    )
    assert adapter.history.await_count == 3


@pytest.mark.parametrize(
    "outgoing,expected", [("Approved body", True), ("Another draft", False)]
)
async def test_manual_confirmation_recovers_only_exact_recruiter_thread(
    outgoing, expected
):
    from booster_recruiter.store import AppError

    adapter = RecruiterBrowser(None, None, None)
    adapter.profile = AsyncMock(return_value={"name": "Candidate"})
    adapter.history = AsyncMock(
        return_value=[
            {
                "thread_id": "recruiter:verified",
                "subject": "Subject",
                "sender": "from Recruiter",
            }
        ]
    )
    adapter.thread_messages = AsyncMock(
        return_value=[{"sender": "Recruiter", "body": outgoing}]
    )
    args = (
        "https://www.linkedin.com/in/candidate",
        None,
        {"contract": "Contract", "sender_name": "Recruiter"},
        "Approved body",
        "Subject",
    )
    if expected:
        result = await adapter.check_reply(*args)
        assert result["thread_id"] == "recruiter:verified" and not result["has_reply"]
    else:
        with pytest.raises(AppError, match="восстановить"):
            await adapter.check_reply(*args)

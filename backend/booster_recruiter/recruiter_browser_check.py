"""Local DOM cases for Recruiter recipient, exact text and cost write guards."""

from unittest.mock import AsyncMock
from urllib.parse import quote

from .recruiter_browser import RecruiterBrowser
from .store import AppError


async def check_recruiter_browser(page):
    await page.route(
        "**/*", lambda route: route.fulfill(body="<main/>", content_type="text/html")
    )
    cases = [
        "ok",
        "recipient",
        "subject",
        "signature",
        "credits",
        "followup",
        "contract",
        "draft",
    ]
    for case in cases:
        await page.goto(
            "https://www.linkedin.com/talent/profile/ACoATest?rightRail=composer"
        )
        await page.set_content("""<span data-test-user-contract-name>Approved contract</span>
         <div data-view-name="messaging-composer">
          <span data-test-recipient-pill data-recipient-pill-id="urn:li:ts_profile:Test">Test Recipient</span>
          <div data-test-messaging-composer>
           <input data-test-compose-subject-input>
           <div contenteditable="true" role="textbox"></div>
           <p data-test-signature-display>Recruiter</p>
          </div>
          <p>Send immediately via InMail</p>
          <span data-test-inmail-credits-text="INMAIL_GUARD">1/8 InMail Credits</span>
          <button data-test-messaging-submit-btn type="button">Send</button>
         </div>""")
        await page.evaluate(
            """mode=>{
          window.sendCount=0;
          document.querySelector('button').onclick=()=>window.sendCount++;
          const editor=document.querySelector('[contenteditable]');
          if(mode==='draft')editor.textContent='Existing personal draft';
          editor.addEventListener('input',()=>{
            if(mode==='recipient')document.querySelector('[data-test-recipient-pill]').setAttribute('data-recipient-pill-id','urn:li:ts_profile:Other');
            if(mode==='subject')document.querySelector('input').value='Unapproved subject';
            if(mode==='signature')document.querySelector('[data-test-signature-display]').textContent='Other signature';
            if(mode==='credits')document.querySelector('[data-test-inmail-credits-text]').textContent='1/0 InMail Credits';
            if(mode==='followup'){const extra=document.createElement('div');extra.dataset.testMessagingComposer='';document.querySelector('[data-view-name]').append(extra);}
            if(mode==='contract')document.querySelector('[data-test-user-contract-name]').textContent='Other contract';
          });
        }""",
            case,
        )
        adapter = RecruiterBrowser(page, None, None)
        adapter.status = AsyncMock(
            return_value={
                "contract": "Approved contract",
                "manual_texts": True,
                "credits": 8,
            }
        )
        adapter.observe = AsyncMock(
            return_value={
                "inmail": True,
                "credits": 8,
                "recruiter_target": {
                    "profile_url": "https://www.linkedin.com/talent/profile/ACoATest"
                },
                "recruiter_composer": {
                    "channel": "INMAIL_GUARD",
                    "signature": "Recruiter",
                    "recipient": "urn:li:ts_profile:Test",
                    "name": "Test Recipient",
                },
            }
        )
        adapter.confirm = AsyncMock(return_value=True)
        result = await adapter.send(
            "https://www.linkedin.com/in/test",
            "Hello, test recipient.\n\nRecruiter",
            "Approved subject",
            {"contract": "Approved contract", "signature": "Recruiter"},
            1,
        )
        assert result["sent"] is (case == "ok"), (case, result)
        assert await page.evaluate("window.sendCount") == int(case == "ok"), case
        if case == "draft":
            assert (
                await page.locator("[contenteditable]").inner_text()
                == "Existing personal draft"
            )
    # Real Chromium, observed Recruiter history schema, synthetic identities.
    # A colleague's message or the Pending label is never a candidate reply.
    history_cases = ["outgoing", "reply", "colleague", "foreign_thread"]
    urn = "urn:li:ts_candidate_message_thread:(urn:li:ts_contract:1,urn:li:ts_hire_identity:2,urn:li:ts_prospect_comm_history:3)"
    base = "https://www.linkedin.com/talent/profile/ACoATest/messages"
    href = base + "?thread=" + quote(urn, safe="")
    target = {
        "url": "https://www.linkedin.com/in/test",
        "name": "Test Recipient",
        "messages_url": base,
    }
    context = {"contract": "Approved contract", "sender_name": "Recruiter"}
    for case in history_cases:
        await page.goto(href)
        row_href = (
            href if case != "foreign_thread" else href.replace("ACoATest", "Other")
        )
        extra = ""
        if case in {"reply", "colleague"}:
            who = "Test Recipient" if case == "reply" else "Another recruiter"
            extra = f"<li><p data-test-message-list-entity-sender-name>{who}</p><p data-test-message-list-entity-body>Thank you.</p></li>"
        await page.set_content(f"""<span data-test-user-contract-name>Approved contract</span>
          <div data-live-test-profile-messages-tab-content>
           <ol data-test-message-threads-list><li data-test-message-threads-list-item><a href="{row_href}">
            <p data-test-message-thread-item-subject>Approved subject</p>
            <p data-test-message-thread-item-sender>from Recruiter</p>
            <p data-test-message-thread-item-preview>Approved body</p>
            <span data-test-message-state-entity>Pending</span>
           </a></li></ol>
          </div>
          <div data-test-right-rail><h3 data-test-right-rail-header>Approved subject</h3>
           <ol data-test-message-list><li>
            <p data-test-message-list-entity-sender-name>Recruiter</p>
            <p data-test-message-list-entity-body>Approved body</p>
           </li>{extra}</ol>
          </div>""")
        adapter = RecruiterBrowser(page, None, None)
        adapter.go = AsyncMock()
        adapter.profile = AsyncMock(return_value=target)
        try:
            result = await adapter.check_reply(
                target["url"], "recruiter:" + urn, context
            )
        except AppError:
            assert case == "foreign_thread", case
        else:
            assert case != "foreign_thread", case
            assert result["has_reply"] is (case == "reply"), (case, result)
            assert result["reply_text"] == ("Thank you." if case == "reply" else "")
            assert await adapter.confirm(
                target, context, "Approved body", "Approved subject"
            )
            assert adapter.confirmed_thread == "recruiter:" + urn
    return len(cases) + len(history_cases)

"""Local DOM cases for Recruiter recipient, exact text and cost write guards."""

from unittest.mock import AsyncMock, patch
from urllib.parse import quote

from booster_linkedin.linkedin.session import PageSession

from .recruiter_browser import RECIPIENT_IDENTITY_JS, RecruiterBrowser
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
        "stale_recipient",
        "missing_recipient",
        "missing_mapping",
        "free_ok",
        "free_channel_changed",
        "paid_channel_changed",
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
          if(mode==='free_ok'||mode==='free_channel_changed'){
            const price=document.querySelector('[data-test-inmail-credits-text]');price.setAttribute('data-test-inmail-credits-text','FREE_INMAIL');price.textContent='Free to InMail';
          }
          if(mode==='stale_recipient')document.querySelector('[data-test-recipient-pill]').setAttribute('data-recipient-pill-id','urn:li:ts_profile:Other');
          if(mode==='missing_recipient')document.querySelector('[data-test-recipient-pill]').removeAttribute('data-recipient-pill-id');
          if(mode==='draft')editor.textContent='Existing personal draft';
          editor.addEventListener('input',()=>{
            if(mode==='recipient')document.querySelector('[data-test-recipient-pill]').setAttribute('data-recipient-pill-id','urn:li:ts_profile:Other');
            if(mode==='subject')document.querySelector('input').value='Unapproved subject';
            if(mode==='signature')document.querySelector('[data-test-signature-display]').textContent='Other signature';
            if(mode==='credits')document.querySelector('[data-test-inmail-credits-text]').textContent='1/0 InMail Credits';
            if(mode==='followup'){const extra=document.createElement('div');extra.dataset.testMessagingComposer='';document.querySelector('[data-view-name]').append(extra);}
            if(mode==='contract')document.querySelector('[data-test-user-contract-name]').textContent='Other contract';
            if(mode==='free_channel_changed')document.querySelector('[data-test-inmail-credits-text]').setAttribute('data-test-inmail-credits-text','INMAIL_GUARD');
            if(mode==='paid_channel_changed')document.querySelector('[data-test-inmail-credits-text]').setAttribute('data-test-inmail-credits-text','FREE_INMAIL');
          });
        }""",
            case,
        )
        adapter = RecruiterBrowser(page, PageSession(page), None)
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
                    "profile_url": "https://www.linkedin.com/talent/profile/ACoATest",
                    "recipient_urn": None
                    if case == "missing_mapping"
                    else "urn:li:ts_profile:Test",
                },
                "recruiter_composer": {
                    "channel": "FREE_INMAIL"
                    if case in {"free_ok", "free_channel_changed"}
                    else "INMAIL_GUARD",
                    "signature": "Recruiter",
                    "recipient": "urn:li:ts_profile:Other"
                    if case == "stale_recipient"
                    else None
                    if case == "missing_recipient"
                    else "urn:li:ts_profile:Test",
                    "name": "Test Recipient",
                },
            }
        )
        adapter.confirm = AsyncMock(return_value=True)
        try:
            result = await adapter.send(
                "https://www.linkedin.com/in/test",
                "Hello, test recipient.\n\nRecruiter",
                "Approved subject",
                {"contract": "Approved contract", "signature": "Recruiter"},
                0 if case in {"free_ok", "free_channel_changed"} else 1,
            )
        except AppError:
            assert case in {
                "stale_recipient",
                "missing_recipient",
                "missing_mapping",
            }, case
        else:
            assert result["sent"] is (case in {"ok", "free_ok"}), (case, result)
        assert await page.evaluate("window.sendCount") == int(
            case in {"ok", "free_ok"}
        ), case
        if case in {"ok", "free_ok"}:
            assert result["credit_cost"] == int(case == "ok")
        if case == "draft":
            assert (
                await page.locator("[contenteditable]").inner_text()
                == "Existing personal draft"
            )
    mapping_cases = [
        "ok",
        "wrong_profile",
        "ambiguous_profile",
        "wrong_contract",
        "invalid_urn",
        "wrong_name",
    ]
    for case in mapping_cases:
        expected_url = "https://www.linkedin.com/in/approved-recipient"
        link = (
            "https://www.linkedin.com/in/someone-else"
            if case == "wrong_profile"
            else expected_url
        )
        markup = f'<span data-test-user-contract-name>{"Other" if case == "wrong_contract" else "Approved contract"}</span><a data-test-personal-info-profile-link href="{link}">Profile</a>'
        if case == "ambiguous_profile":
            markup += (
                f'<a data-test-personal-info-profile-link href="{link}">Duplicate</a>'
            )

        async def document(route):
            await route.fulfill(body=markup, content_type="text/html")

        await page.context.route("**/*", document)

        async def local_navigation(reader, url):
            assert url == "https://www.linkedin.com/talent/profile/NativeRecipientId"
            await reader.page.goto(url)

        before = list(page.context.pages)
        adapter = RecruiterBrowser(page, PageSession(page), None)
        state = {
            "valid": True,
            "recipient": "urn:li:ts_profile:NativeRecipientId",
            "name": "Candidate",
        }
        if case == "invalid_urn":
            state["recipient"] = "urn:li:ts_profile:../other"
        if case == "wrong_name":
            state["name"] = "Another candidate"
        try:
            with patch.object(RecruiterBrowser, "go", local_navigation):
                result = await adapter.verify_recipient_profile(
                    {"url": expected_url, "name": "Candidate"},
                    state,
                    "Approved contract",
                )
        except Exception:
            if case == "ok":
                raise
        else:
            assert case == "ok" and result == state["recipient"], case
        finally:
            await page.context.unroute("**/*", document)
        assert list(page.context.pages) == before, case
    identity_cases = [
        "ok",
        "sidebar",
        "foreign",
        "ambiguous",
        "missing",
        "duplicate_parameter",
    ]
    for case in identity_cases:
        await page.goto("https://www.linkedin.com/talent/profile/ACoATest")
        href = "/talent/search?firstDegreeConnectionId=urn%3Ali%3Ats_profile%3ATest"
        if case == "foreign":
            href = "https://example.invalid" + href
        if case == "duplicate_parameter":
            href += "&firstDegreeConnectionId=urn%3Ali%3Ats_profile%3AOther"
        link = f'<a data-test-connections-link href="{href}">Connections</a>'
        top = "" if case in {"sidebar", "missing"} else link
        await page.set_content(
            "<div data-test-profile-topcard-wrapper>"
            + top
            + (link if case == "ambiguous" else "")
            + "</div>"
            + (link if case == "sidebar" else "")
        )
        identity = await page.evaluate(RECIPIENT_IDENTITY_JS)
        assert identity == ("urn:li:ts_profile:Test" if case == "ok" else None), (
            case,
            identity,
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
        adapter = RecruiterBrowser(page, PageSession(page), None)
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
    empty_cases = [
        "empty",
        "hidden_empty",
        "stale_empty_with_history",
        "loading",
        "ambiguous_empty",
    ]
    for case in empty_cases:
        await page.goto(base)
        marker = "<p data-test-empty-messages>No messages</p>"
        if case == "hidden_empty":
            marker = '<p data-test-empty-messages style="display:none">No messages</p>'
        elif case == "loading":
            marker = ""
        elif case == "ambiguous_empty":
            marker += marker
        rows = (
            "<div data-test-message-threads-list-item>Existing thread</div>"
            if case == "stale_empty_with_history"
            else ""
        )
        await page.set_content(
            '<span data-test-user-contract-name>Approved contract</span><div data-live-test-profile-messages-tab-content style="min-height:20px">'
            + marker
            + rows
            + "</div>"
        )
        adapter = RecruiterBrowser(page, PageSession(page), None)
        adapter.go = AsyncMock()
        empty = await adapter.empty_history(
            target | {"recipient_urn": "urn:li:ts_profile:Test"}, "Approved contract"
        )
        assert empty is (case == "empty"), (case, empty)
    return (
        len(cases)
        + len(mapping_cases)
        + len(identity_cases)
        + len(history_cases)
        + len(empty_cases)
    )

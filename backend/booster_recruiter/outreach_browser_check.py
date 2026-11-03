"""Offline Chromium acceptance cases. Every URL is locally fulfilled."""

import json

from booster_linkedin.linkedin.message_sender import _ProfileMessageTarget
from booster_linkedin.linkedin.navigation import PageNavigator
from booster_linkedin.linkedin.session import PageSession

from .outreach_browser import COMPOSER_JS, PROFILE_CONTACT_JS, THREAD_JS, GuardedSender


async def check_outreach_browser(page):
    await page.route(
        "**/*", lambda r: r.fulfill(content_type="text/html", body="<main></main>")
    )
    page.set_default_timeout(600)
    compose = "https://www.linkedin.com/messaging/compose/?recipient=ACoATESTRecipient"
    target = _ProfileMessageTarget(
        profile_path="/in/test-recipient/",
        profile_urn="ACoATESTRecipient",
        compose_url=compose,
        display_name="Test Recipient",
    )
    cases = [
        ("paid_ok", "inmail", True),
        ("free_ok", "message", True),
        ("paid_ok", "message", False),
        ("free_ok", "inmail", False),
        ("zero_credits", "inmail", False),
        ("unknown_credits", "inmail", False),
        ("ambiguous_credits", "inmail", False),
        ("existing_subject", "inmail", False),
        ("wrong_recipient", "inmail", False),
        ("tampered_subject", "inmail", False),
        ("lost_credits", "inmail", False),
    ]
    message = "Hello, Test Recipient!\nA new opportunity."
    for mode, kind, should_send in cases:
        await page.goto(compose)
        paid = mode != "free_ok"
        credits = (
            "0 credits remaining"
            if mode == "zero_credits"
            else "Buy credits"
            if mode == "unknown_credits"
            else "3 credits remaining 4 credits available"
            if mode == "ambiguous_credits"
            else "3 credits remaining"
        )
        subject = (
            '<input name="subject" value="My existing draft">'
            if mode == "existing_subject"
            else '<input name="subject">'
        )
        recipient = "someone-else" if mode == "wrong_recipient" else "test-recipient"
        await page.set_content(f"""<html><body><main><section><div id="history"></div>
          <form data-recipient-urn="{"ACoAOTHER" if mode == "wrong_recipient" else "ACoATESTRecipient"}">
          <a href="/in/{recipient}/">Recipient</a>
          {'<p>InMail</p><p id="credits">' + credits + "</p>" + subject if paid else ""}
          <div role="textbox" contenteditable="true" id="editor" style="min-height:40px"><p><br></p></div>
          <button id="send" type="submit">Send</button></form></section></main></body></html>""")
        await page.evaluate(
            r"""({mode,message})=>{
          document.querySelector('form').addEventListener('submit',e=>e.preventDefault());
          if(mode==='tampered_subject'||mode==='lost_credits')document.querySelector('#editor').addEventListener('input',()=>{
            if(mode==='tampered_subject')document.querySelector('input').value='Unapproved subject';
            else document.querySelector('#credits').textContent='0 credits remaining';
          });
          document.querySelector('#send').addEventListener('click',e=>{
            e.preventDefault(); document.body.dataset.clicks=String(Number(document.body.dataset.clicks||0)+1);
            document.body.dataset.sentSubject=document.querySelector('input')?.value||'';
            setTimeout(()=>{
              history.replaceState({},'', '/messaging/thread/outreach-test-thread/');
              const pane=document.createElement('div');pane.className='msg-thread';
              const header=document.createElement('a');header.href='/in/ACoATESTRecipient';header.textContent='Recipient';pane.append(header);
              const item=document.createElement('div');item.dataset.viewName='message-list-item';item.dataset.eventUrn='urn:li:msg_message:(urn:li:fsd_profile:ACoATESTSelf,new-id)';
              const author=document.createElement('a');author.href='/in/ACoATESTSelf/';author.textContent='Me';item.append(author);
              const outer=document.createElement('div'),middle=document.createElement('div'),inner=document.createElement('div'),p=document.createElement('p');
              message.split('\n').forEach((line,i)=>{if(i)p.append(document.createElement('br'));p.append(document.createTextNode(line));});
              inner.append(p);middle.append(inner);outer.append(middle);item.append(outer);pane.append(item);
              document.querySelector('main').replaceChildren(pane);
            },20);
          });
        }""",
            {"mode": mode, "message": message},
        )
        session = PageSession(page)
        sender = GuardedSender(
            session, PageNavigator(session), kind, "Approved subject"
        )
        result = await sender._submit_to_verified_composer(
            message, target=target, expected_route=page.url
        )
        assert result["sent"] is should_send, json.dumps(
            {"case": mode, "kind": kind, "result": result}
        )
        clicks = await page.evaluate("Number(document.body.dataset.clicks||0)")
        assert clicks == int(should_send), (mode, result, clicks)
        if should_send and kind == "inmail":
            assert (
                await page.evaluate("document.body.dataset.sentSubject")
                == "Approved subject"
            )
        if mode == "existing_subject":
            assert await page.locator("input").input_value() == "My existing draft"

    # Relationship signals must be scoped to the requested top card.
    for badge, expected in [
        ("", "not_connected"),
        ('<span class="distance-badge">1st</span>', "connected"),
        ("<span>· 1st</span>", "connected"),
        ("<p>· 1st</p>", "connected"),
    ]:
        await page.goto("https://www.linkedin.com/in/test-recipient/")
        await page.set_content(
            "<main><section><h1>Test Recipient</h1>"
            + badge
            + '<a href="/preload/custom-invite/?vanityName=test-recipient">Connect</a></section><aside><span class="distance-badge">1st</span></aside></main>'
        )
        contact = await page.evaluate(
            PROFILE_CONTACT_JS, {"username": "test-recipient"}
        )
        assert contact["relationship"] == expected, contact
        assert not (
            await page.evaluate(PROFILE_CONTACT_JS, {"username": "different-person"})
        )["identity_verified"]

    for pending_target, expected in [
        ("test-recipient", "pending"),
        ("another", "unknown"),
    ]:
        await page.goto("https://www.linkedin.com/in/test-recipient/")
        await page.set_content(
            "<main><section><h1>Test Recipient</h1><p>· 3rd</p></section></main>"
            f'<div role="menu"><a href="/in/{pending_target}/"><div aria-label="Pending, click to withdraw invitation sent to Test Recipient">Pending</div></a></div>'
        )
        contact = await page.evaluate(
            PROFILE_CONTACT_JS, {"username": "test-recipient"}
        )
        assert contact["relationship"] == expected and not contact["can_invite"], (
            contact
        )

    await page.goto("https://www.linkedin.com/in/test-recipient/")
    await page.set_content(
        "<main><section><section><h2>Test Recipient</h2><p>· 3rd</p>"
        '<button aria-label="Accept Test Recipient’s request to connect">Accept</button>'
        '<button aria-label="Ignore Test Recipient’s request to connect">Ignore</button>'
        "<section>Hiring card without a heading</section></section>"
        "<section><h2>Activity</h2><p>· 1st</p></section></section></main>"
    )
    contact = await page.evaluate(PROFILE_CONTACT_JS, {"username": "test-recipient"})
    assert contact["identity_verified"] and contact["relationship"] == "incoming", (
        contact
    )
    assert not contact["can_invite"]

    # InMail credit claims in the message draft are not pricing chrome.
    await page.goto(compose)
    await page.set_content(
        '<main><section><form><div role="textbox" contenteditable="true">InMail 500 credits remaining</div><button type="submit">Send</button></form></section></main>'
    )
    pricing = await page.evaluate(COMPOSER_JS)
    assert pricing["free"] and pricing["credits"] is None, pricing

    for author, verified, replied in [
        ("ACoATESTRecipient", True, True),
        ("ACoATESTSelf", True, False),
        ("ACoAOther", False, False),
    ]:
        await page.set_content(
            f'<main><div class="msg-thread"><a href="/in/ACoATESTRecipient/">Recipient</a><div data-event-urn="urn:li:msg_message:(urn:li:fsd_profile:ACoATESTSelf,event)"><a href="/in/{author}">Author</a><p>Hello</p></div></div></main>'
        )
        state = await page.evaluate(
            THREAD_JS, {"path": "/in/test-recipient/", "urn": "ACoATESTRecipient"}
        )
        assert state["verified"] is verified and state["has_reply"] is replied, state
    page.set_default_timeout(30000)
    return len(cases) + 11

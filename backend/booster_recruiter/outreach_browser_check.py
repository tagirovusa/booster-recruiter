"""Offline Chromium acceptance cases. Every URL is locally fulfilled."""

import json

from booster_linkedin.linkedin.message_sender import _ProfileMessageTarget
from booster_linkedin.linkedin.navigation import PageNavigator
from booster_linkedin.linkedin.session import PageSession

from .outreach_browser import (
    COMPOSER_JS,
    PROFILE_CONTACT_JS,
    THREAD_JS,
    GuardedSender,
    InviteOnly,
)


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
    connection_cases = await check_connection_layouts(page)
    page.set_default_timeout(30000)
    return len(cases) + 11 + connection_cases + await check_search_browser(page)


async def check_search_browser(page):
    from .worker import SEARCH_JS

    cases = [
        "normal",
        "mutuals",
        "hidden",
        "ambiguous",
        "foreign",
        "unknown_layout",
        "nested_list",
    ]
    for case in cases:
        await page.goto("https://www.linkedin.com/search/results/people/?keywords=test")
        await page.set_content("""<main><div data-sdui-screen="com.linkedin.sdui.flagshipnav.search.SearchResultsPeople">
         <div role="list" id="results"><div componentkey="SearchResults_FirstResult_people"><div role="listitem" id="result"></div></div></div>
         <div role="listitem"><a tabindex="0" componentkey="suggestion" href="/in/sidebar">Suggestion</a></div>
         </div><a href="/in/unrelated">Unrelated</a></main>""")
        await page.evaluate(
            """mode=>{
          const row=document.querySelector('#result'),a=document.createElement('a');
          a.href=mode==='foreign'?'https://foreign.invalid/in/candidate':'/in/candidate';a.tabIndex=0;a.setAttribute('componentkey','candidate');a.textContent='Candidate';row.append(a);
          if(mode==='mutuals')for(const id of ['mutual-one','mutual-two']){const mutual=document.createElement('a');mutual.href='/in/'+id;mutual.textContent=id;a.append(mutual);}
          if(mode==='hidden')row.style.display='none';
          if(mode==='ambiguous'){const other=a.cloneNode(true);other.href='/in/another-primary';row.append(other);}
          if(mode==='unknown_layout')document.querySelector('[componentkey="SearchResults_FirstResult_people"]').removeAttribute('componentkey');
          if(mode==='nested_list'){const nested=document.createElement('div');nested.setAttribute('role','list');nested.innerHTML='<div role="listitem"><a tabindex="0" componentkey="extra" href="/in/extra">Extra</a></div>';document.querySelector('#results').append(nested);}
        }""",
            case,
        )
        profiles = await page.evaluate(SEARCH_JS)
        expected = case in {"normal", "mutuals", "nested_list"}
        assert [p["url"] for p in profiles] == (
            ["https://www.linkedin.com/in/candidate"] if expected else []
        ), (case, profiles)
    return len(cases)


async def check_connection_layouts(page):
    from urllib.parse import quote

    key = "ConnectButtonstate:invitation:urn:li:member:12345_connect"
    cases = [
        ("top", "recipient", "recipient", key, True),
        ("menu", "recipient", "recipient", key, True),
        ("unicode", "julija-ambrazienė", "julija-ambrazienė", key, True),
        ("wrong", "recipient", "other", key, False),
        ("sidebar", "recipient", "recipient", key, False),
        ("hidden", "recipient", "recipient", key, False),
        ("disabled", "recipient", "recipient", key, False),
        ("foreign", "recipient", "recipient", key, False),
        ("unknown_key", "recipient", "recipient", "ConnectButtonstate:unknown", False),
        ("unowned_menu", "recipient", "recipient", key, False),
        ("ambiguous_menu", "recipient", "recipient", key, False),
        ("pending", "recipient", "recipient", key, False),
    ]
    for mode, username, href_username, component, expected in cases:
        await page.goto("https://www.linkedin.com/in/" + quote(username) + "/")
        domain = "https://other.example" if mode == "foreign" else ""
        attributes = (
            ' style="display:none"'
            if mode == "hidden"
            else ' aria-disabled="true"'
            if mode == "disabled"
            else ""
        )
        link = f'<a href="{domain}/in/{quote(href_username)}/" componentkey="{component}"{attributes} aria-label="Invite Recipient to connect">Connect</a>'
        outside = mode in {"menu", "unowned_menu", "ambiguous_menu", "sidebar"}
        menu = f'<div role="menu">{link}</div>' if outside and mode != "sidebar" else ""
        top = "" if outside else link
        if mode == "pending":
            top += '<a href="/in/recipient/" aria-label="Pending, click to withdraw invitation">Pending</a>'
        await page.set_content(
            "<main><section><h1>Recipient</h1>"
            + top
            + (
                '<button aria-expanded="true">More</button>'
                if mode in {"menu", "ambiguous_menu"}
                else ""
            )
            + "</section><aside>"
            + (link if mode == "sidebar" else "")
            + "</aside></main>"
            + menu
            + ('<div role="menu">Unrelated</div>' if mode == "ambiguous_menu" else "")
        )
        contact = await page.evaluate(PROFILE_CONTACT_JS, {"username": username})
        assert contact["identity_verified"] and contact["can_invite"] is expected, (
            mode,
            contact,
        )
        if mode == "pending":
            assert contact["relationship"] == "pending"
        if expected:
            connector = InviteOnly(PageSession(page), None, None)
            signals = await connector._read_action_signals(username)
            assert signals.has_invite_anchor and not signals.has_labeled_action_anchor

    # Run the real invitation workflow against local documents, including
    # confirmation after navigation. No LinkedIn traffic or real recipient.
    for layout in ["legacy", "modern", "unicode"]:
        username = "julija-ambrazienė" if layout == "unicode" else "recipient"
        path = "/in/" + quote(username) + "/"
        sent = []

        async def document(route):
            if route.request.url.endswith("/test-confirm-invite"):
                sent.append(True)
                await route.fulfill(body="ok")
                return
            if "/preload/custom-invite/" in route.request.url:
                body = '<div role="dialog" class="send-invite" aria-labelledby="send-invite-modal"><div class="artdeco-modal__content"><p>Invite <strong>Recipient</strong></p></div><div class="artdeco-modal__actionbar"><button class="artdeco-button--secondary">Add note</button><button class="artdeco-button--primary" id="send" onclick="fetch(\'/test-confirm-invite\').then(()=>this.closest(\'[role=dialog]\').remove())">Send</button></div></div>'
            else:
                href = (
                    f"/preload/custom-invite/?vanityName={quote(username)}"
                    if layout == "legacy"
                    else path
                )
                action = (
                    f'<a href="{path}" aria-label="Pending, click to withdraw invitation">Pending</a>'
                    if sent
                    else f'<a href="{href}" componentkey="{key}" aria-label="Invite Recipient to connect">Connect</a>'
                )
                body = f"<main><section><h1>Recipient</h1>{action}</section></main>"
            await route.fulfill(content_type="text/html", body=body)

        await page.route("**/*", document)
        session = PageSession(page)

        async def read_profile(_):
            await page.goto("https://www.linkedin.com" + path)
            return {"sections": {"main_profile": "Recipient"}}

        connector = InviteOnly(session, PageNavigator(session), read_profile)
        result = await connector.connect_with_person(username)
        assert result["status"] == "connected" and len(sent) == 1, (
            layout,
            result,
            sent,
        )
        again = await connector.connect_with_person(username)
        assert again["status"] == "pending" and len(sent) == 1, (layout, again, sent)
        await page.unroute("**/*", document)
    return len(cases) + 3 + await check_invitation_dialogs(page)


async def check_invitation_dialogs(page):
    cases = [
        "plain",
        "note",
        "two_dialogs",
        "wrong_recipient",
        "wrong_route",
        "changed_note",
        "personal_draft",
        "hidden_personal_draft",
        "changed_recipient",
    ]
    for case in cases:
        await page.goto(
            "https://www.linkedin.com/preload/custom-invite/?vanityName=recipient"
        )
        await page.set_content("""<div role="dialog" class="send-invite" aria-labelledby="send-invite-modal">
         <div class="artdeco-modal__content"><p>Invite <strong>Recipient</strong></p></div>
         <div class="artdeco-modal__actionbar"><button class="artdeco-button--secondary" id="add">Add a note</button><button class="artdeco-button--primary" id="invite">Send</button></div></div>""")
        await page.evaluate(
            r"""mode=>{
          window.counts={invite:0,other:0};
          document.querySelector('#invite').onclick=()=>{window.counts.invite++;document.querySelector('.send-invite').remove();};
          document.querySelector('#add').onclick=()=>{
            const area=document.createElement('textarea');document.querySelector('.artdeco-modal__content').append(area);
            area.addEventListener('input',()=>{
              if(mode==='changed_note')area.value='Unapproved note';
              if(mode==='changed_recipient')document.querySelector('strong').textContent='Other person';
            });
          };
          if(mode==='two_dialogs'){
            const other=document.createElement('div');other.setAttribute('role','dialog');other.innerHTML='<button>Unrelated action</button>';
            other.querySelector('button').onclick=()=>window.counts.other++;document.body.append(other);
          }
          if(mode==='wrong_recipient')document.querySelector('strong').textContent='Other person';
          if(mode==='wrong_route')history.replaceState({},'',location.pathname+'?vanityName=other');
          if(mode==='personal_draft'||mode==='hidden_personal_draft'){
            const area=document.createElement('textarea');area.value='My personal draft';if(mode==='hidden_personal_draft')area.style.display='none';document.querySelector('.artdeco-modal__content').append(area);
          }
        }""",
            case,
        )
        connector = InviteOnly(PageSession(page), None, None)
        connector._booster_invite_target = {
            "username": "recipient",
            "name": "Recipient",
        }
        note = (
            "Approved note"
            if case in {"note", "changed_note", "changed_recipient"}
            else None
        )
        sent, note_sent, _ = await connector._submit_invite_dialog(note)
        expected = case in {"plain", "note"}
        assert sent is expected and note_sent is (case == "note"), (
            case,
            sent,
            note_sent,
        )
        assert await page.evaluate("window.counts") == {
            "invite": int(expected),
            "other": 0,
        }, case
        if case in {"personal_draft", "hidden_personal_draft"}:
            assert await page.locator("textarea").input_value() == "My personal draft"
    return len(cases)

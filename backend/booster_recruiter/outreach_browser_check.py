"""Offline Chromium acceptance cases. Every URL is locally fulfilled."""

import json
from unittest.mock import patch

from booster_linkedin.linkedin.connection_actions import ConnectionActions
from booster_linkedin.linkedin.message_sender import (
    MessageSender,
    _ProfileMessageTarget,
)
from booster_linkedin.linkedin.navigation import PageNavigator
from booster_linkedin.linkedin.session import PageSession

from .outreach_browser import (
    COMPOSER_JS,
    PROFILE_CONTACT_JS,
    THREAD_JS,
    GuardedSender,
    InviteOnly,
    PacedMessageSender,
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
        ("pause_ok", "inmail", True),
        ("pause_recipient", "inmail", False),
        ("pause_body", "message", False),
        ("pause_credits", "inmail", False),
        ("pause_challenge", "inmail", False),
        ("pause_limit", "inmail", False),
        ("pause_challenge", "legacy", False),
        ("pause_limit", "legacy", False),
    ]
    message = "Hello, Test Recipient!\nA new opportunity."
    for mode, kind, should_send in cases:
        await page.goto(compose)
        paid = kind != "legacy" and mode not in {"free_ok", "pause_body"}
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
        pause_calls = []

        class SubmitPause:
            async def before_submit(self):
                # Mutate after the draft is populated, exactly while production
                # waits before its final verification/click.
                assert (
                    await page.locator("#editor").inner_text()
                ).split() == message.split()
                pause_calls.append(mode)
                await page.evaluate(
                    """mode=>{
                      if(mode==='pause_recipient')document.querySelector('form').setAttribute('data-recipient-urn','ACoAOTHER');
                      if(mode==='pause_body')document.querySelector('#editor').textContent='Changed while waiting';
                      if(mode==='pause_credits')document.querySelector('#credits').textContent='0 credits remaining';
                      if(mode==='pause_challenge')history.replaceState({},'', '/checkpoint/challenge/');
                      if(mode==='pause_limit'){const notice=document.createElement('div');notice.setAttribute('role','alert');notice.textContent='You have reached your messaging limit';document.body.append(notice);}
                    }""",
                    mode,
                )

        sender = (
            PacedMessageSender(session, PageNavigator(session), pacer=SubmitPause())
            if kind == "legacy"
            else GuardedSender(
                session,
                PageNavigator(session),
                kind,
                "Approved subject",
                pacer=SubmitPause() if mode.startswith("pause_") else None,
            )
        )
        if mode in {"pause_challenge", "pause_limit"}:

            async def send_to_fixture(self, *args, **kwargs):
                return await self._submit_to_verified_composer(
                    message, target=target, expected_route=page.url
                )

            with patch.object(MessageSender, "send_message", send_to_fixture):
                result = await sender.send_message(
                    "test-recipient", message, confirm_send=True
                )
        else:
            result = await sender._submit_to_verified_composer(
                message, target=target, expected_route=page.url
            )
        assert result["sent"] is should_send, json.dumps(
            {"case": mode, "kind": kind, "result": result}
        )
        clicks = await page.evaluate("Number(document.body.dataset.clicks||0)")
        assert clicks == int(should_send), (mode, result, clicks)
        if mode.startswith("pause_"):
            assert pause_calls == [mode], (mode, pause_calls)
        if mode in {"pause_challenge", "pause_limit"}:
            flag = "auth_required" if mode == "pause_challenge" else "platform_limited"
            assert sender.submit_refusal[flag] is True, (mode, sender.submit_refusal)
            assert result[flag] is True, (mode, result)
            assert result["retry_safe"] is True, (mode, result)
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
    return (
        len(cases)
        + 11
        + connection_cases
        + await check_search_browser(page)
        + await check_platform_limit_notices(page)
        + await check_delivery_recovery(page)
    )


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
        "pause_ok",
        "pause_recipient",
        "pause_note",
        "pause_challenge",
        "pause_limit",
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
        pause_calls = []

        class InvitePause:
            async def step(self):
                pass

            async def before_submit(self):
                pause_calls.append(case)
                if case == "pause_note":
                    assert (
                        await page.locator("textarea").input_value() == "Approved note"
                    )
                await page.evaluate(
                    """mode=>{
                      if(mode==='pause_recipient')document.querySelector('strong').textContent='Other person';
                      if(mode==='pause_note')document.querySelector('textarea').value='Changed while waiting';
                      if(mode==='pause_challenge')history.replaceState({},'', '/checkpoint/challenge/');
                      if(mode==='pause_limit'){const notice=document.createElement('div');notice.setAttribute('role','alert');notice.textContent='You have reached your weekly invitation limit';document.body.append(notice);}
                    }""",
                    case,
                )

        connector = InviteOnly(
            PageSession(page),
            None,
            None,
            pacer=InvitePause() if case.startswith("pause_") else None,
        )
        connector._booster_invite_target = {
            "username": "recipient",
            "name": "Recipient",
        }
        note = (
            "Approved note"
            if case in {"note", "changed_note", "changed_recipient", "pause_note"}
            else None
        )
        if case in {"pause_challenge", "pause_limit"}:

            async def connect_to_fixture(self, username, *, note=None):
                sent, note_sent, message = await self._submit_invite_dialog(note)
                return {"invited": sent, "note_sent": note_sent, "message": message}

            with patch.object(
                ConnectionActions, "connect_with_person", connect_to_fixture
            ):
                result = await connector.connect_with_person("recipient", note=note)
            sent, note_sent = result["invited"], False
            flag = "auth_required" if case == "pause_challenge" else "platform_limited"
            assert result[flag] is True and result["retry_safe"] is True, (case, result)
        else:
            sent, note_sent, _ = await connector._submit_invite_dialog(note)
        expected = case in {"plain", "note", "pause_ok"}
        if case.startswith("pause_"):
            assert pause_calls == [case], (case, pause_calls)
        if case in {"pause_challenge", "pause_limit"}:
            flag = "auth_required" if case == "pause_challenge" else "platform_limited"
            assert connector.submit_refusal[flag] is True, (
                case,
                connector.submit_refusal,
            )
            assert not getattr(connector, "_booster_invite_attempted", False)
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


async def check_platform_limit_notices(page):
    from .platform_limits import (
        LinkedInLimitError,
        check_platform_limit,
        read_platform_limit,
    )

    notice = "You've reached the weekly invitation limit"
    cases = [
        (f'<main><h1>Recipient</h1></main><div role="dialog">{notice}</div>', True),
        (
            '<main></main><div role="alert">You have reached your messaging limit</div>',
            True,
        ),
        (
            '<main></main><div class="artdeco-toast-item">Invitation limit reached</div>',
            True,
        ),
        (
            '<main></main><div role="dialog">Вы достигли недельного лимита приглашений</div>',
            True,
        ),
        (f"<main><p>{notice}</p></main>", False),
        (f'<div role="dialog"><textarea>{notice}</textarea></div>', False),
        (f'<div role="dialog"><div contenteditable="true">{notice}</div></div>', False),
        (
            f'<div role="dialog"><div data-event-urn="message">{notice}</div></div>',
            False,
        ),
        (f'<div role="alert" style="display:none">{notice}</div>', False),
        ('<div role="dialog">0 InMail credits remaining</div>', False),
        ('<div role="dialog">An invitation is pending</div>', False),
    ]
    await page.goto("https://www.linkedin.com/in/recipient/")
    for html, expected in cases:
        await page.set_content(html)
        result = await read_platform_limit(PageSession(page))
        assert bool(result) is expected, (html, result)
    await page.set_content(f'<main></main><div role="dialog">{notice}</div>')
    connector = InviteOnly(PageSession(page), None, None)
    connector._booster_invite_target = {"username": "recipient", "name": "Recipient"}
    try:
        await connector._submit_invite_dialog(None)
    except LinkedInLimitError:
        pass
    else:
        raise AssertionError("LinkedIn limit did not prevent invitation submission")
    try:
        await check_platform_limit(PageSession(page))
    except LinkedInLimitError:
        pass
    else:
        raise AssertionError("Platform notice was not surfaced as a limit")
    return len(cases) + 2


async def check_delivery_recovery(page):
    """Read-only recovery cannot confuse an old or incoming identical message."""
    from datetime import datetime, timedelta, timezone

    from .outreach_browser import DELIVERY_PROOF_JS

    current = datetime.now(timezone.utc)
    cases = [
        ("valid", True),
        ("old", False),
        ("missing_time", False),
        ("incoming", False),
        ("wrong_recipient", False),
        ("local_id", False),
        ("wrong_text", False),
        ("two_panes", False),
        ("duplicate", False),
        ("wrong_subject", False),
        ("future", False),
    ]
    for mode, expected in cases:
        await page.goto("https://www.linkedin.com/messaging/thread/verified-thread/")
        timestamp = (
            current - timedelta(seconds=20 if mode == "old" else 2)
        ).isoformat()
        if mode == "future":
            timestamp = (current + timedelta(days=1)).isoformat()
        await page.set_content(
            '<main><section class="msg-thread"><a href="/in/test-recipient/">Recipient</a></section></main>'
        )
        await page.evaluate(
            """({mode,timestamp})=>{
          const pane=document.querySelector('.msg-thread');
          if(mode==='wrong_recipient')pane.querySelector('a').href='/in/someone-else/';
          const item=document.createElement('div');item.dataset.viewName='message-list-item';
          item.dataset.eventUrn=mode==='local_id'?'local-placeholder':'urn:li:msg_message:(urn:li:fsd_profile:ACoATESTSelf,new-server-id)';
          item.innerHTML='<a href="/in/'+(mode==='incoming'?'ACoATESTRecipient':'ACoATESTSelf')+'/">Author</a><div><div><p>'+(mode==='wrong_text'?'Other message':'Exact message')+'</p></div></div>';
          if(mode!=='missing_time'){const t=document.createElement('time');t.dateTime=timestamp;item.append(t);}
          pane.append(item);
          if(mode==='duplicate'){const other=item.cloneNode(true);other.dataset.eventUrn='urn:li:msg_message:(urn:li:fsd_profile:ACoATESTSelf,another-server-id)';pane.append(other);}
          if(mode==='two_panes')document.querySelector('main').append(pane.cloneNode(true));
        }""",
            {"mode": mode, "timestamp": timestamp},
        )
        result = await page.evaluate(
            DELIVERY_PROOF_JS,
            {
                "path": "/in/test-recipient/",
                "urn": "ACoATESTRecipient",
                "message": "Exact message",
                "since": (current - timedelta(seconds=5)).isoformat(),
                "subject": "Subject" if mode == "wrong_subject" else "",
            },
        )
        assert result["confirmed"] is expected, (mode, result)
    return len(cases)

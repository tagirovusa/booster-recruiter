"""Offline browser regressions for the observed read-only LinkedIn thread.

All routes are fulfilled locally. These checks never contact LinkedIn or send
real messages; they exercise the production sender against synthetic DOMs.
"""

import json


async def check_send_confirmation(page):
    from booster_linkedin.linkedin.message_sender import (
        MessageSender,
        _ProfileMessageTarget,
    )
    from booster_linkedin.linkedin.navigation import PageNavigator
    from booster_linkedin.linkedin.session import PageSession

    compose = "https://www.linkedin.com/messaging/compose/?recipient=ACoATESTRecipient"
    target = _ProfileMessageTarget(
        profile_path="/in/test-recipient/",
        profile_urn="ACoATESTRecipient",
        compose_url=compose,
        display_name="Test Recipient",
    )
    cases = [
        ("confirmed", "Hello, Test Recipient!", True),
        ("confirmed", "Hello, Test Recipient!\n\nA second paragraph.", True),
        ("wrong_recipient", "Hello, Test Recipient!", False),
        ("incoming", "Hello, Test Recipient!", False),
        ("other_sender", "Hello, Test Recipient!", False),
        ("local_placeholder", "Hello, Test Recipient!", False),
        ("old_message", "Hello, Test Recipient!", False),
        ("wrong_text", "Hello, Test Recipient!", False),
        ("no_header", "Hello, Test Recipient!", False),
        ("two_panes", "Hello, Test Recipient!", False),
        ("other_thread", "Hello, Test Recipient!", False),
    ]
    await page.route(
        "**/*",
        lambda route: route.fulfill(
            content_type="text/html", body="<html><body></body></html>"
        ),
    )
    page.set_default_timeout(700)
    page.set_default_navigation_timeout(10000)
    for mode, message, should_confirm in cases:
        await page.goto(compose)
        await page.set_content("""<!doctype html><html><body><main>
          <section><div id="history"></div><form data-recipient-urn="ACoATESTRecipient">
          <a href="/in/test-recipient/">Test Recipient</a>
          <div id="editor" role="textbox" contenteditable="true" style="min-height:40px"><p><br></p></div>
          <button id="send" type="submit">Send</button></form></section>
          </main></body></html>""")
        await page.evaluate(
            r"""({mode, message}) => {
              const serverId='urn:li:msg_message:(urn:li:fsd_profile:ACoATESTSelf,new-server-id)';
              const bubble = (text, urn, sender) => {
                const item=document.createElement('div');
                item.dataset.viewName='message-list-item';item.dataset.eventUrn=urn;
                const author=document.createElement('a');author.href='/in/'+sender+'/';
                author.textContent='Sender'; item.append(author);
                const outer=document.createElement('div'), middle=document.createElement('div'), inner=document.createElement('div'), body=document.createElement('p');
                text.split('\n').forEach((line,index)=>{if(index)body.append(document.createElement('br'));body.append(document.createTextNode(line));});
                inner.append(body);middle.append(inner);outer.append(middle);item.append(outer);
                return item;
              };
              if (mode==='old_message') document.querySelector('#history').append(bubble(message,serverId,'ACoATESTSelf'));
              if (mode==='other_thread') history.replaceState({},'', '/messaging/thread/original-thread/');
              document.querySelector('form').addEventListener('submit',event=>event.preventDefault());
              document.querySelector('#send').addEventListener('click', event => {
                event.preventDefault();
                document.body.dataset.clicks=String(Number(document.body.dataset.clicks||0)+1);
                setTimeout(()=>{
                  history.replaceState({},'', '/messaging/thread/confirmed-thread/');
                  const pane=document.createElement('div');pane.className='msg-thread';
                  if(mode!=='no_header') {
                    const header=document.createElement('a');
                    header.href='/in/'+(mode==='wrong_recipient'?'someone-else':'ACoATESTRecipient');
                    header.textContent='Recipient';pane.append(header);
                  }
                  const sender=mode==='incoming'?'ACoATESTRecipient':mode==='other_sender'?'ACoAOTHER':'ACoATESTSelf';
                  pane.append(bubble(mode==='wrong_text'?'Different message':message,mode==='local_placeholder'?'local-id':serverId,sender));
                  const notice=document.createElement('p');notice.textContent='You have not received a response yet.';pane.append(notice);
                  document.querySelector('main').replaceChildren(pane);
                  if(mode==='two_panes') document.querySelector('main').append(pane.cloneNode(true));
                },20);
              });
            }""",
            {"mode": mode, "message": message},
        )
        session = PageSession(page)
        sender = MessageSender(session, PageNavigator(session))
        result = await sender._submit_to_verified_composer(
            message, target=target, expected_route=page.url
        )
        assert result["sent"] is should_confirm, json.dumps(
            {"case": mode, "result": result}
        )
        assert result["retry_safe"] is False, (mode, result)
        assert await page.evaluate("document.body.dataset.clicks") == "1", mode
        if should_confirm:
            assert result["thread_id"] == "confirmed-thread", result
        else:
            assert result["status"] == "send_unconfirmed", result
    page.set_default_timeout(30000)
    return len(cases)

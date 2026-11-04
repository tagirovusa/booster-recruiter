"""Browser-only outreach adapters for the ordinary linkedin.com interface.

Unknown layouts fail closed. No private API, premium bypass or inferred send
success. Paid composers must expose both a subject and a current credit balance.
"""

from booster_linkedin.linkedin.connection import ActionSignals
from booster_linkedin.linkedin.connection_actions import ConnectionActions
from booster_linkedin.linkedin.identifiers import normalize_person_identifier
from booster_linkedin.linkedin.message_sender import (
    _MESSAGE_COMPOSER_PINNED_JS,
    _MESSAGE_COMPOSER_SUBMIT_JS,
    MessageSender,
    _message_page_url_is_safe,
)
from booster_linkedin.linkedin.navigation import PageNavigator
from booster_linkedin.linkedin.session import PageSession

from .platform_limits import LinkedInLimitError, check_platform_limit
from .store import canonical

PROFILE_CONTACT_JS = r"""({username}) => {
 const visible=e=>!!e&&e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden';
 const decoded=value=>{try{return decodeURIComponent(value).normalize('NFC').toLowerCase();}catch{return null;}};
 const path='/in/'+username.normalize('NFC').toLowerCase();
 if(decoded(location.pathname.replace(/\/$/,''))!==path) return {identity_verified:false};
 const main=document.querySelector('main');
 const heading=Array.from(main?.querySelectorAll('h1,h2')||[]).find(e=>visible(e)&&!e.closest('aside'));
 const card=heading?.closest('section');
 if(!card||Array.from(card.querySelectorAll('h1,h2,h3')).filter(visible).length!==1)return {identity_verified:false};
 const links=Array.from(card.querySelectorAll('a[href]')).filter(visible);
 const self=links.some(a=>new URL(a.href).origin===location.origin&&decoded(new URL(a.href).pathname)===path+'/edit/intro/');
 const menuLinks=Array.from(document.querySelectorAll('[role="menu"] a[href]')).filter(visible);
 const ownProfile=a=>{try{const u=new URL(a.href);return u.origin===location.origin&&decoded(u.pathname.replace(/\/$/,''))===path;}catch{return false;}};
 // The new Connect anchors link back to the profile, not custom-invite.
 // Require LinkedIn's invitation-state key AND the exact requested profile.
 // A portal menu also requires the top card's expanded menu and a unique menu.
 const menus=Array.from(document.querySelectorAll('[role="menu"]')).filter(visible);
 const menuOwned=menus.length===1&&Array.from(card.querySelectorAll('button[aria-expanded="true"]')).some(visible);
 const invite=[...links,...(menuOwned?menuLinks:[])].some(a=>{
   if(a.getAttribute('aria-disabled')==='true')return false;
   try{const u=new URL(a.href);if(u.origin===location.origin&&u.pathname==='/preload/custom-invite/'&&u.searchParams.get('vanityName')?.normalize('NFC').toLowerCase()===username.normalize('NFC').toLowerCase())return true;}catch{return false;}
   return ownProfile(a)&&/^ConnectButtonstate:invitation:urn:li:member:\d+_connect$/.test(a.getAttribute('componentkey')||'');
 });
 const pending=[...links,...menuLinks].some(a=>ownProfile(a)&&/pending|withdraw invitation|ожидан|приглашение отправлено|отозвать приглашение/i.test([a.getAttribute('aria-label'),...Array.from(a.querySelectorAll('[aria-label]')).map(e=>e.getAttribute('aria-label'))].join(' ')));
 const connected=Array.from(card.querySelectorAll('.distance-badge,.dist-value,[data-test-distance-badge],span,p')).filter(visible).some(e=>/^(1st(?: degree connection)?|1-й|контакт 1-го уровня)$/i.test((e.getAttribute('aria-label')||e.innerText||'').replace(/·/g,'').trim()));
 const buttons=Array.from(card.querySelectorAll('button[aria-label]')).filter(visible);
 const incoming=buttons.some(e=>/^(Accept\b.*request to connect|Принять\b.*приглашени)/i.test(e.getAttribute('aria-label')))&&buttons.some(e=>/^(Ignore\b.*request to connect|Отклонить\b.*приглашени)/i.test(e.getAttribute('aria-label')));
 return {identity_verified:true,display_name:heading.innerText.trim(),relationship:self?'self':incoming?'incoming':pending?'pending':connected?'connected':invite?'not_connected':'unknown',can_invite:invite&&!self&&!incoming&&!pending&&!connected};
}"""

INVITE_DIALOG_GUARD_JS = r"""
 const visible=e=>!!e&&e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden';
 const norm=s=>(s||'').normalize('NFC').replace(/\s+/g,' ').trim();
 const u=new URL(location.href);
 const names=u.searchParams.getAll('vanityName');
 const dialogs=[...document.querySelectorAll('dialog[open],[role="dialog"]')].filter(e=>visible(e)&&!e.querySelector('[contenteditable="true"]'));
 const recipient=[...node.querySelectorAll('.artdeco-modal__content p strong')].filter(visible);
 const valid=()=>node.isConnected&&visible(node)&&dialogs.length===1&&dialogs[0]===node&&
  node.matches('div[role="dialog"].send-invite[aria-labelledby="send-invite-modal"]')&&
  u.origin==='https://www.linkedin.com'&&u.pathname==='/preload/custom-invite/'&&
  names.length===1&&norm(names[0]).toLowerCase()===norm(arg.username).toLowerCase()&&
  location.href===arg.route&&recipient.length===1&&norm(recipient[0].innerText)===norm(arg.name);
"""

# Shared inspector: reads pricing chrome without counting the message body.
COMPOSER_INSPECT = r"""
 const visible=e=>!!e&&e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden';
 const editors=Array.from(document.querySelectorAll('[role="textbox"][contenteditable="true"]')).filter(visible);
 if(editors.length!==1)return {valid:false};
 const editor=editors[0];
 const owner=editor.closest('form,dialog,[role="dialog"]');
 if(!owner)return {valid:false};
 const scope=owner.closest('.msg-thread')||owner.parentElement;
 if(!scope||Array.from(scope.querySelectorAll('[contenteditable="true"]')).filter(visible).length!==1)return {valid:false};
 const subjects=Array.from(scope.querySelectorAll('input[name*="subject" i],input[id*="subject" i],input[placeholder*="subject" i],input[aria-label*="subject" i],input[placeholder*="тема" i],input[aria-label*="тема" i]')).filter(visible);
 const texts=Array.from(scope.querySelectorAll('*')).filter(e=>visible(e)&&!e.children.length&&!e.closest('[contenteditable="true"],textarea,[data-event-urn]')).map(e=>e.innerText||'').join(' ');
 const matches=[...texts.matchAll(/(?:\b(\d+)\s+(?:InMail\s+)?credits?\s+(?:left|remaining|available)\b|\bInMail credits\s*[:：]\s*(\d+)\b|(?:доступно|осталось)\s+(\d+)\s+(?:кредит|сообщени))/gi)].map(m=>Number(m[1]||m[2]||m[3]));
 const credits=matches.length&&matches.every(n=>n===matches[0])?matches[0]:null;
 const paidMarker=/\bInMail\b|\bcredits?\b|кредит/i.test(texts);
 return {valid:true,subjectCount:subjects.length,subjectValue:subjects[0]?.value||'',paid:subjects.length===1&&paidMarker,free:subjects.length===0&&!paidMarker,credits,subject:subjects[0]||null,editor,owner};
"""
COMPOSER_JS = (
    "() => { const s=(()=>{"
    + COMPOSER_INSPECT
    + "})(); return {...s,subject:undefined,editor:undefined,owner:undefined}; }"
)

THREAD_JS = r"""({path,urn})=>{
 const visible=e=>!!e&&e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden';
 const panes=Array.from(document.querySelectorAll('main .msg-thread')).filter(visible);
 const pane=panes.length===1?panes[0]:null;
 if(!pane)return {verified:false};
 const profile=a=>{try{const u=new URL(a.href);if(u.protocol!=='https:'||!/(^|\.)linkedin\.com$/.test(u.hostname))return null;return u.pathname.replace(/\/$/,'').toLowerCase();}catch{return null;}};
 const matches=a=>[path.toLowerCase().replace(/\/$/,''),'/in/'+urn.toLowerCase()].includes(profile(a));
 const headers=Array.from(pane.querySelectorAll('a[href*="/in/"]')).filter(a=>visible(a)&&!a.closest('[data-event-urn]'));
 if(!headers.length||!headers.every(matches))return {verified:false};
 const items=Array.from(pane.querySelectorAll('[data-event-urn]')).filter(visible);
 let incoming=false,outgoing=false,unresolved=false,author=null,replyText='';
 for(const item of items){
  const own=(item.getAttribute('data-event-urn')||'').match(/^urn:li:msg_message:\(urn:li:fsd_profile:([A-Za-z0-9_-]+),[^)]+\)$/)?.[1];
  if(!own){unresolved=true;continue;}
  const links=Array.from(item.querySelectorAll('a[href*="/in/"]')).filter(a=>!a.closest('.msg-s-event-listitem__body,[data-view-name="message-body"]'));
  if(links.length){const ids=links.map(profile);if(ids.every(p=>p==='/in/'+own.toLowerCase()))author='own';else if(links.every(matches))author='recipient';else author=null;}
  if(author==='own')outgoing=true;else if(author==='recipient'){incoming=true;replyText=Array.from(item.querySelectorAll('p')).map(p=>p.innerText||'').join('\n').slice(0,4000);}else unresolved=true;
 }
 return {verified:!unresolved,has_reply:incoming,has_outgoing:outgoing,reply_text:replyText,count:items.length,ids:items.map(e=>e.getAttribute('data-event-urn'))};
}"""


def refusal(message):
    return {"sent": False, "invited": False, "retry_safe": True, "message": message}


class GuardedSender(MessageSender):
    def __init__(self, session, navigator, kind="message", subject=""):
        super().__init__(session, navigator)
        self.kind, self.subject = kind, subject

    async def _read_message_composer_state(self, target):
        state = await super()._read_message_composer_state(target)
        if state.get("status") != "valid":
            return state
        pricing = await self._session.run_on_linkedin(COMPOSER_JS)
        allowed = (
            pricing.get("free")
            if self.kind == "message"
            else pricing.get("paid")
            and type(pricing.get("credits")) is int
            and pricing["credits"] > 0
        )
        return state if allowed else {"status": "unverified_message_channel"}

    async def _write_verified_message(self, message, *, target, owner):
        empty_history = await owner.evaluate(
            """node=>{const scope=node.closest('.msg-thread')||node.parentElement;return !!scope&&!scope.querySelector('[data-event-urn]');}"""
        )
        if not empty_history:
            return "occupied"
        if self.kind == "inmail":
            if not self.subject or len(self.subject) > 200 or "\n" in self.subject:
                return "invalid"
            written = await owner.evaluate(
                """(owner,arg)=>{
              const node=owner;
              if(location.protocol!=='https:'||!/(^|\\.)linkedin\\.com$/.test(location.hostname))return false;
              """
                + _MESSAGE_COMPOSER_PINNED_JS
                + """
              if(!validatePinned(arg,false))return false;
              const s=(()=>{"""
                + COMPOSER_INSPECT
                + """})();
              const pinned=node.__boosterLinkedInComposer;
              if(!pinned||!s.valid||!s.paid||s.credits<1||s.credits===null||s.editor!==pinned.editor||!node.contains(s.editor)||s.subjectValue)return false;
              const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
              setter.call(s.subject,arg.subject);s.subject.dispatchEvent(new Event('input',{bubbles:true}));s.subject.dispatchEvent(new Event('change',{bubbles:true}));
              node.__boosterSubject={element:s.subject,value:arg.subject}; return s.subject.value===arg.subject;
            }""",
                {"subject": self.subject, **self._message_target_argument(target)},
            )
            if not written:
                return "occupied"
        return await super()._write_verified_message(
            message, target=target, owner=owner
        )

    async def _submit_verified_message(self, message, *, target, owner):
        # Same owner, exact subject and pricing immediately before the click.
        await check_platform_limit(self._session)
        result = await owner.evaluate(
            """(node,arg)=>{
          if(location.protocol!=='https:'||!/(^|\\.)linkedin\\.com$/.test(location.hostname))return false;
          const s=(()=>{"""
            + COMPOSER_INSPECT
            + """})();
          if(!node.__boosterLinkedInComposer||s.editor!==node.__boosterLinkedInComposer.editor)return false;
          const scope=node.closest('.msg-thread')||node.parentElement;
          if(!scope||scope.querySelector('[data-event-urn]'))return 'invalid';
          const p=node.__boosterSubject;
          const valid=arg.kind==='message'?s.free===true:(s.paid===true&&s.credits>0&&p?.element===s.subject&&p.value===arg.subject&&s.subjectValue===arg.subject);
          if(!valid)return 'invalid';
          return ("""
            + _MESSAGE_COMPOSER_SUBMIT_JS
            + """)(node,arg);
        }""",
            {
                "kind": self.kind,
                "subject": self.subject,
                "message": message,
                **self._message_target_argument(target),
            },
        )
        return "clicked" if result == "clicked" else "invalid"

    @staticmethod
    async def _cleanup_owned_message(message, owner):
        await MessageSender._cleanup_owned_message(message, owner)
        try:
            await owner.evaluate(
                """node=>{const p=node.__boosterSubject;if(p?.element?.isConnected&&p.element.value===p.value){const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(p.element,'');p.element.dispatchEvent(new Event('input',{bubbles:true}));}delete node.__boosterSubject;}"""
            )
        except Exception:
            pass


class InviteOnly(ConnectionActions):
    async def connect_with_person(self, username, *, note=None):
        self._booster_invite_attempted = False
        try:
            return await super().connect_with_person(username, note=note)
        except LinkedInLimitError:
            raise
        except Exception:
            if self._booster_invite_attempted:
                return {
                    "status": "outcome_unknown",
                    "message": "Исход отправки приглашения не подтверждён.",
                }
            raise

    async def _read_action_signals(self, username):
        contact = await self._session.run_on_linkedin(
            PROFILE_CONTACT_JS, {"username": username}
        )
        if (
            contact.get("identity_verified")
            and contact.get("relationship") == "unknown"
        ):
            await self._open_more_menu()
            contact = await self._session.run_on_linkedin(
                PROFILE_CONTACT_JS, {"username": username}
            )
        relationship = (
            contact.get("relationship") if contact.get("identity_verified") else None
        )
        if relationship == "not_connected" and contact.get("can_invite") is True:
            self._booster_invite_target = {
                "username": username,
                "name": contact.get("display_name", ""),
            }
        # Feed the vendor's dialog workflow only positively verified states.
        # An aria-labelled anchor can now mean Connect as well as Pending;
        # Message alone is never proof of an existing connection.
        return ActionSignals(
            has_invite_anchor=relationship == "not_connected"
            and contact.get("can_invite") is True,
            has_compose_anchor_in_action_root=relationship == "connected",
            has_edit_intro_anchor=relationship == "self",
            has_labeled_action_button=False,
            has_labeled_action_anchor=relationship == "pending",
            has_incoming_action_row=relationship == "incoming",
        )

    async def _click_incoming_accept(self):
        # An invitation approval never authorizes accepting an incoming request.
        return False

    async def _submit_invite_dialog(self, note):
        await check_platform_limit(self._session)
        target = getattr(self, "_booster_invite_target", None)
        if not target or not target["name"]:
            return False, False, None
        selector = 'div[role="dialog"].send-invite[aria-labelledby="send-invite-modal"]'
        try:
            owner = await self._session.page.wait_for_selector(
                selector, state="visible", timeout=5000
            )
        except Exception:
            await check_platform_limit(self._session)
            return False, False, None
        arg = target | {"route": self._session.page.url, "note": note or ""}
        # Pin one known invitation dialog and keep personal drafts untouched.
        initial = await owner.evaluate(
            "(node,arg)=>{"
            + INVITE_DIALOG_GUARD_JS
            + """
             if(!valid())return false;
             const areas=[...node.querySelectorAll('textarea')];
             if(areas.length>1||areas.some(e=>e.value))return false;
             node.__boosterInvite={clicked:false};return true;
            }""",
            arg,
        )
        if initial is not True:
            return False, False, None
        if note:
            opened = await owner.evaluate(
                "(node,arg)=>{"
                + INVITE_DIALOG_GUARD_JS
                + """
                 if(!valid())return false;
                 if([...node.querySelectorAll('textarea')].some(visible))return true;
                 const buttons=[...node.querySelectorAll('.artdeco-modal__actionbar button.artdeco-button--secondary')].filter(visible);
                 if(buttons.length!==1||buttons[0].disabled)return false;
                 buttons[0].click();return true;
                }""",
                arg,
            )
            if not opened:
                return False, False, None
            try:
                textarea = await owner.wait_for_selector(
                    "textarea", state="visible", timeout=3000
                )
            except Exception:
                # Reading the native quota message never authorizes no-note fallback.
                return False, False, await self._get_premium_upsell_message()
            if await textarea.input_value():
                return False, False, None
            await textarea.fill(note)
        # A response can disappear after dispatch. Mark uncertainty before the
        # atomic click and never retry via Enter or a second locator click.
        self._booster_invite_attempted = True
        submitted = await owner.evaluate(
            "(node,arg)=>{"
            + INVITE_DIALOG_GUARD_JS
            + """
             const p=node.__boosterInvite;
             if(!valid()||!p||p.clicked)return false;
             const areas=[...node.querySelectorAll('textarea')];
             if(arg.note?(areas.length!==1||!visible(areas[0])||areas[0].value!==arg.note):areas.some(e=>e.value))return false;
             const buttons=[...node.querySelectorAll('.artdeco-modal__actionbar button.artdeco-button--primary')].filter(visible);
             if(buttons.length!==1||buttons[0].disabled||buttons[0].getAttribute('aria-disabled')==='true')return false;
             p.clicked=true;buttons[0].click();return true;
            }""",
            arg,
        )
        if submitted is not True:
            self._booster_invite_attempted = False
            return False, False, None
        # Allow the native request to settle before the vendor reopens the
        # profile. A persistent dialog after a click is an uncertain outcome.
        try:
            await owner.wait_for_element_state("hidden", timeout=5000)
        finally:
            await check_platform_limit(self._session)
        return True, bool(note), None


class BrowserOutreach:
    def __init__(self, page, read_profile=None, read_conversation=None):
        self.session = PageSession(page)
        self.navigator = PageNavigator(self.session)
        self.sender = MessageSender(self.session, self.navigator)
        self.page = page
        self.read_profile = read_profile
        self.read_conversation = read_conversation

    async def open_profile(self, url):
        expected = canonical(url)
        await self.navigator._navigate_to_page(expected + "/")
        await self.session.check_rate_limit()
        if canonical(self.page.url) != expected:
            raise ValueError(
                "LinkedIn открыл другой профиль. Проверьте адрес в браузере."
            )
        return {"opened": True, "url": expected}

    async def observe(self, url, check_history=False, relationship_only=False):
        username = normalize_person_identifier(url)
        await self.navigator._navigate_to_page(canonical(url) + "/")
        await self.session.check_rate_limit()
        await self.page.wait_for_selector("main", timeout=15000)
        # This wait is also used for the redesigned, asynchronously mounted top card.
        resolution = await self.sender._read_profile_message_target(timeout_ms=8000)
        result = await self.session.run_on_linkedin(
            PROFILE_CONTACT_JS, {"username": username}
        )
        result.update(
            free_message=False, inmail=False, credits=None, history_verified=False
        )
        if result.get("identity_verified") is not True:
            return result
        if result.get("relationship") in ("self", "incoming"):
            return result
        connector = InviteOnly(self.session, self.navigator, self.read_profile)
        signals = await connector._read_action_signals(username)
        # More may have revealed a portal-mounted Pending control whose label
        # belongs to a child div instead of its exact-profile anchor.
        refreshed = await self.session.run_on_linkedin(
            PROFILE_CONTACT_JS, {"username": username}
        )
        if refreshed.get("identity_verified") is not True:
            return result | {"identity_verified": False}
        result.update(refreshed)
        if signals.has_incoming_action_row:
            result.update(relationship="incoming", can_invite=False)
        if relationship_only:
            return result
        target = resolution.target
        if (
            not target
            or normalize_person_identifier(target.profile_path).casefold()
            != username.casefold()
        ):
            return result
        await self.navigator._navigate_to_page(target.compose_url)
        if not _message_page_url_is_safe(self.page.url, target.profile_urn):
            return {"identity_verified": False}
        expected_route = self.page.url
        if not await self.sender._wait_for_message_composer(target):
            # Existing unanswered threads can have no composer. Read history only.
            state = await self.session.run_on_linkedin(
                THREAD_JS, {"path": target.profile_path, "urn": target.profile_urn}
            )
            if state.get("verified"):
                result.update(
                    history_verified=True,
                    has_reply=state["has_reply"],
                    has_outgoing=state["has_outgoing"],
                    reply_text=state.get("reply_text", ""),
                )
            return result
        if self.page.url != expected_route:
            return {"identity_verified": False}
        state = await self.sender._read_message_composer_state(target)
        if state.get("status") != "valid" or state.get("empty") is not True:
            return result
        pricing = await self.session.run_on_linkedin(COMPOSER_JS)
        result.update(
            free_message=pricing.get("free") is True,
            inmail=pricing.get("paid") is True,
            credits=pricing.get("credits"),
        )
        if check_history:
            history = await self.session.run_on_linkedin(
                THREAD_JS, {"path": target.profile_path, "urn": target.profile_urn}
            )
            if history.get("verified"):
                result.update(
                    history_verified=True,
                    has_reply=history["has_reply"],
                    has_outgoing=history["has_outgoing"],
                    reply_text=history.get("reply_text", ""),
                )
            else:
                # Empty compose is allowed only if no events exist in its unique
                # verified editor's own pane. Never treat an unknown thread as empty.
                empty = await self.session.run_on_linkedin(
                    """()=>{
                  const s=(()=>{"""
                    + COMPOSER_INSPECT
                    + """})();
                  const scope=s.owner?.closest('.msg-thread')||s.owner?.parentElement;
                  return !!s.valid&&!!scope&&!scope.querySelector('[data-event-urn]')&&location.pathname==='/messaging/compose/';
                }"""
                )
                result["history_verified"] = bool(empty)
                if not empty and self.read_conversation is not None:
                    # LinkedIn can render existing messages in a new-compose
                    # pane without the thread header that proves who owns it.
                    # Open the real conversation and recheck its exact profile
                    # links; never infer an empty history from that layout.
                    await self.read_conversation({"linkedin_username": url})
                    history = await self.session.run_on_linkedin(
                        THREAD_JS,
                        {"path": target.profile_path, "urn": target.profile_urn},
                    )
                    if history.get("verified"):
                        result.update(
                            history_verified=True,
                            has_reply=history["has_reply"],
                            has_outgoing=history["has_outgoing"],
                            reply_text=history.get("reply_text", ""),
                        )
            if not result["history_verified"]:
                result.update(free_message=False, inmail=False, credits=None)
        return result

    async def invite(self, url, note):
        before = await self.observe(url, relationship_only=True)
        if not before.get("identity_verified") or not before.get("can_invite"):
            return refusal(
                "Приглашение недоступно, уже отправлено или контакт уже существует."
            )
        if self.read_profile is None:
            return refusal("Чтение профиля для приглашения не настроено.")
        connector = InviteOnly(self.session, self.navigator, self.read_profile)
        result = await connector.connect_with_person(
            normalize_person_identifier(url), note=note or None
        )
        if result.get("status") == "connected":
            after = await self.observe(url, relationship_only=True)
            confirmed = (
                after.get("identity_verified") is True
                and after.get("relationship") == "pending"
            )
            if note and result.get("note_sent") is not True:
                confirmed = False
            return {
                "invited": confirmed,
                "retry_safe": False,
                "message": "Приглашение подтверждено как ожидающее принятия."
                if confirmed
                else "Отправка приглашения не подтверждена. Проверьте профиль перед повтором.",
            }
        if result.get("status") in ("send_failed", "outcome_unknown", "accepted"):
            return {
                "invited": False,
                "retry_safe": False,
                "message": "Исход приглашения не подтверждён. Проверьте профиль.",
            }
        return refusal(result.get("message", "Приглашение не отправлено."))

    async def send(self, url, message, subject=None):
        # Same read-only duplicate check immediately before navigating to send.
        observation = await self.observe(url, check_history=True)
        if (
            not observation.get("identity_verified")
            or not observation.get("history_verified")
            or observation.get("has_reply")
            or observation.get("has_outgoing")
        ):
            return refusal(
                "Профиль или история не подтверждены, либо переписка уже начата."
            )
        kind = "inmail" if subject is not None else "message"
        if kind == "message" and not observation.get("free_message"):
            return refusal(
                "Бесплатная отправка недоступна. InMail-кредиты не расходуются."
            )
        if kind == "inmail" and not (
            observation.get("inmail")
            and type(observation.get("credits")) is int
            and observation["credits"] > 0
        ):
            return refusal(
                "Нет подтверждённой формы платного InMail с доступными кредитами."
            )
        sender = GuardedSender(self.session, self.navigator, kind, subject or "")
        return await sender.send_message(url, message, confirm_send=True)

    async def check_reply(self, url, thread_id, open_conversation):
        observation = await self.observe(url)
        # The target URN is read again from the exact profile, not a name match.
        await self.navigator._navigate_to_page(canonical(url) + "/")
        resolution = await self.sender._read_profile_message_target(timeout_ms=8000)
        target = resolution.target
        if not target or not observation.get("identity_verified"):
            return {
                "has_reply": False,
                "detail": "Проверка ответа пока недоступна: не подтверждён профиль.",
            }
        if thread_id:
            await open_conversation({"thread_id": thread_id})
        else:
            await open_conversation({"linkedin_username": url})
        state = await self.session.run_on_linkedin(
            THREAD_JS, {"path": target.profile_path, "urn": target.profile_urn}
        )
        return {
            "has_reply": state.get("verified") is True
            and state.get("has_reply") is True,
            "reply_text": state.get("reply_text", "") if state.get("verified") else "",
            "detail": "Получен ответ. Автоматические обращения остановлены."
            if state.get("verified") and state.get("has_reply")
            else "Ответ пока не подтверждён.",
        }

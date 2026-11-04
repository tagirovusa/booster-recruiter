"""LinkedIn Recruiter UI adapter. All identities come from rendered profile links.

No private APIs. Drafts, automatic follow-ups and changed contracts fail closed.
"""

import re
from urllib.parse import parse_qs, urlparse

from .platform_limits import before_submit_guard, check_platform_limit
from .store import AppError, canonical

ORIGIN = "https://www.linkedin.com"
PREFERENCES = ORIGIN + "/talent/account/v2/ai-preferences"
USAGE = ORIGIN + "/talent/account/v2/usage-overview"
VISIBLE_JS = "const visible=e=>!!e&&e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden';"
CONTRACT_JS = """() => {
 const nodes=[...document.querySelectorAll('[data-test-user-contract-name]')];
 const names=[...new Set(nodes.map(e=>e.textContent.trim()).filter(Boolean))];
 return names.length===1?names[0]:null;
}"""
RECIPIENT_IDENTITY_JS = r"""() => {
 const cards=[...document.querySelectorAll('[data-test-profile-topcard-wrapper]')];
 if(cards.length!==1)return null;
 const ids=[...cards[0].querySelectorAll('a[data-test-connections-link][href]')].map(a=>{
  try{const u=new URL(a.href);if(u.origin!==location.origin||u.pathname!=='/talent/search')return null;
   const values=u.searchParams.getAll('firstDegreeConnectionId');
   return values.length===1&&/^urn:li:ts_profile:[A-Za-z0-9_-]+$/.test(values[0])?values[0]:null;
  }catch{return null;}
 });
 return ids.length===1?ids[0]:null;
}"""
COMPOSER_JS = (
    """() => {"""
    + VISIBLE_JS
    + """
 const containers=[...document.querySelectorAll('[data-view-name="messaging-composer"]')].filter(visible);
 if(containers.length!==1)return {valid:false};
 const scope=containers[0];
 const editors=[...scope.querySelectorAll('[contenteditable=true]')].filter(visible);
 const subjects=[...scope.querySelectorAll('[data-test-compose-subject-input]')].filter(visible);
 const recipients=[...scope.querySelectorAll('[data-test-recipient-pill]')].filter(visible);
 const sends=[...scope.querySelectorAll('[data-test-messaging-submit-btn]')].filter(visible);
 const channels=[...scope.querySelectorAll('[data-test-inmail-credits-text]')].filter(visible);
 if(editors.length!==1||subjects.length!==1||recipients.length!==1||sends.length!==1||channels.length!==1)return {valid:false};
 const signature=scope.querySelector('[data-test-signature-display]')?.innerText.trim()||'';
 return {valid:true,recipient:recipients[0].getAttribute('data-recipient-pill-id'),name:recipients[0].innerText.trim(),
  subject:subjects[0].value,body:editors[0].innerText.trim(),signature,
  channel:channels[0].getAttribute('data-test-inmail-credits-text'),pricing:channels[0].innerText.trim(),
  send_enabled:!sends[0].disabled,
  scheduled:/Send immediately via InMail/.test(scope.innerText)!==true,
  followups:scope.querySelectorAll('[data-test-messaging-composer]').length!==1,
  generating:!!scope.querySelector('[data-test-inline-generating-outside-hiring-project-or-missing-job-title]')};
}"""
)


def normalized(text):
    return re.sub(r"\s+", " ", text or "").strip()


class RecruiterBrowser:
    def __init__(self, page, session, navigator, *, pacer=None):
        self.page, self.session, self.navigator = page, session, navigator
        self.pacer = pacer
        self.confirmed_thread = None

    async def go(self, url):
        if urlparse(url).hostname != "www.linkedin.com":
            raise AppError("Недопустимый адрес Recruiter.")
        await self.navigator._navigate_to_page(url)
        await self.session.check_rate_limit()
        if not self.page.url.startswith(ORIGIN + "/talent/"):
            raise AppError(
                "Войдите в LinkedIn Recruiter в открытом окне и повторите проверку."
            )
        if "/two-step-verification" in self.page.url:
            raise AppError("LinkedIn Recruiter требует включить двухэтапную проверку.")
        if "/contract-chooser" in self.page.url:
            raise AppError(
                "Выберите нужный контракт Recruiter в окне LinkedIn и повторите проверку."
            )
        await self.page.wait_for_selector(
            "[data-test-user-contract-name]", timeout=15000
        )

    async def contract(self, expected=None):
        actual = await self.page.evaluate(CONTRACT_JS)
        if not actual or (expected and actual != expected):
            raise AppError(
                "Контракт Recruiter изменился или не подтверждён. Проверьте подключение и план."
            )
        return actual

    async def status(self):
        await self.go(USAGE)
        contract = await self.contract()
        balance = self.page.locator(
            "[data-test-usage-overview-container-inmail-balance]"
        )
        await balance.wait_for(state="visible", timeout=15000)
        raw = (await balance.inner_text()).strip()
        if not re.fullmatch(r"\d[\d,\s\u00a0]*", raw):
            raise AppError("Не удалось прочитать остаток кредитов Recruiter.")
        credits = int(re.sub(r"\D", "", raw))
        await self.go(PREFERENCES)
        await self.contract(contract)
        await self.page.get_by_role(
            "button", name="Edit Enable single message auto-draft", exact=True
        ).wait_for(timeout=15000)
        flags = await self.page.evaluate("""() => {
         const keys=['Enable single message auto-draft','Enable touch up auto-draft for 1:1 messages'];
         return keys.map(key=>{const b=document.querySelector('button[aria-label="Edit '+key+'"]');
          if(!b)return {name:key,value:null};
          const row=b.closest('[data-test-selector="account-setting-item"]');
          return {name:key,value:row?.querySelector('[data-test-selector="editable-setting-core-state"]')?.textContent.trim()||null};});
        }""")
        return {
            "status": "ready",
            "contract": contract,
            "credits": credits,
            "manual_texts": all(f["value"] == "Off" for f in flags),
            "preferences": flags,
        }

    async def prepare_manual_texts(self):
        state = await self.status()
        for setting in state["preferences"]:
            if setting["value"] == "Off":
                continue
            if setting["value"] != "On":
                raise AppError(
                    "Не удалось подтвердить настройку автоматических текстов Recruiter."
                )
            await self.page.get_by_role(
                "button", name="Edit " + setting["name"], exact=True
            ).click()
            labels = self.page.locator("label[data-test-setting-label-off]:visible")
            if await labels.count() != 1:
                raise AppError("Неоднозначная настройка текста Recruiter.")
            await labels.click()
            await self.page.get_by_role("button", name="Save", exact=True).click()
            await self.page.get_by_role(
                "button", name="Edit " + setting["name"], exact=True
            ).wait_for()
        return await self.status()

    async def profile(self, url, expected_contract):
        url = canonical(url)
        await self.navigator._navigate_to_page(url + "/")
        await self.session.check_rate_limit()
        if canonical(self.page.url) != url:
            raise AppError("LinkedIn открыл другой профиль.")
        await self.page.wait_for_selector(
            'main a[href*="/talent/profile/"]', timeout=15000
        )
        links = await self.page.evaluate("""() => {
          const heading=[...document.querySelectorAll('main h1,main h2')].find(e=>e.getClientRects().length&&!e.closest('aside'));
          const card=heading?.closest('section');return [...new Set([...card?.querySelectorAll('a[href*="/talent/profile/"]')||[]].map(e=>e.href))];
        }""")
        if len(links) != 1 or not re.fullmatch(
            r"/talent/profile/[A-Za-z0-9_-]+/?", urlparse(links[0]).path
        ):
            raise AppError(
                "Не найден однозначный переход к этому человеку в Recruiter."
            )
        await self.go(links[0])
        await self.contract(expected_contract)
        public = self.page.locator("[data-test-personal-info-profile-link]")
        await public.wait_for(state="attached", timeout=15000)
        if (
            await public.count() != 1
            or canonical(await public.get_attribute("href")) != url
        ):
            raise AppError("Профиль Recruiter не совпадает с утверждённым получателем.")
        profile_url = ORIGIN + urlparse(links[0]).path.rstrip("/")
        tab = self.page.locator(
            f'a[data-test-navigation-list-item][href^="{urlparse(profile_url).path}/messages"]'
        )
        await tab.first.wait_for(state="visible", timeout=15000)
        if await tab.count() != 1:
            raise AppError("Не удалось найти историю этого профиля в Recruiter.")
        return {
            "url": url,
            # Read the Recruiter namespace from the independently verified
            # target card, never derive it from its different public ID.
            "recipient_urn": await self.page.evaluate(RECIPIENT_IDENTITY_JS),
            "name": (
                await self.page.locator(
                    "[data-test-profile-topcard-wrapper] [data-test-row-lockup-full-name]"
                ).inner_text()
            ).strip(),
            "profile_url": profile_url,
            "messages_url": ORIGIN + await tab.get_attribute("href"),
        }

    async def empty_history(self, target, contract):
        await self.go(target["messages_url"])
        await self.contract(contract)
        pane = self.page.locator("[data-live-test-profile-messages-tab-content]")
        await pane.wait_for(state="visible", timeout=15000)
        if self.page.url.split("?")[0].rstrip("/") != target["messages_url"].split("?")[
            0
        ].rstrip("/"):
            raise AppError("История Recruiter открылась для другого профиля.")
        if not target.get("recipient_urn"):
            # The connections link can finish mounting while history loads.
            # This is still the same exact route and public-profile backlink.
            public = self.page.locator("[data-test-personal-info-profile-link]")
            if (
                await public.count() == 1
                and canonical(await public.get_attribute("href")) == target["url"]
            ):
                target["recipient_urn"] = await self.page.evaluate(
                    RECIPIENT_IDENTITY_JS
                )
        return await pane.evaluate("""node=>{
          const visible=e=>!!e&&e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden';
          const empty=[...node.querySelectorAll('[data-test-empty-messages]')].filter(visible);
          return empty.length===1&&!node.querySelector('[data-test-message-threads-list-item]');
        }""")

    async def verify_recipient_profile(self, target, state, contract):
        """Resolve a rendered recipient ID through its native profile page.

        Compact cards can omit the connections link. A second read-only tab
        checks the composer's actual ID against the approved public URL without
        guessing an ID conversion or disturbing the composer.
        """
        urn = state.get("recipient", "") or ""
        if (
            not state.get("valid")
            or not re.fullmatch(r"urn:li:ts_profile:[A-Za-z0-9_-]+", urn)
            or not normalized(target.get("name"))
            or normalized(state.get("name")) != normalized(target["name"])
        ):
            raise AppError(
                "Не удалось подтвердить идентификатор адресата Recruiter. Отправка остановлена."
            )
        from booster_linkedin.linkedin.navigation import PageNavigator
        from booster_linkedin.linkedin.session import PageSession

        check = await self.page.context.new_page()
        try:
            session = PageSession(check)
            reader = RecruiterBrowser(check, session, PageNavigator(session))
            await reader.go(ORIGIN + "/talent/profile/" + urn.rsplit(":", 1)[1])
            await reader.contract(contract)
            public = check.locator("[data-test-personal-info-profile-link]")
            await public.wait_for(state="attached", timeout=15000)
            if (
                await public.count() != 1
                or canonical(await public.get_attribute("href")) != target["url"]
            ):
                raise AppError(
                    "Профиль адресата редактора Recruiter не совпадает с утверждённым получателем."
                )
            return urn
        finally:
            await check.close()

    async def compose(self, target, contract):
        await self.go(target["profile_url"])
        await self.contract(contract)
        button = self.page.locator(
            '[data-test-profile-topcard-wrapper] button[data-test-component="message-icon-btn"]'
        )
        await button.wait_for(state="visible", timeout=15000)
        if await button.count() != 1:
            raise AppError(
                "Не найдена однозначная кнопка сообщения в карточке Recruiter."
            )
        await button.click()
        await self.page.wait_for_selector(
            '[data-view-name="messaging-composer"] [contenteditable=true]',
            timeout=20000,
        )
        await self.page.wait_for_timeout(500)
        state = await self.page.evaluate(COMPOSER_JS)
        if not target.get("recipient_urn"):
            route = self.page.url
            target["recipient_urn"] = await self.verify_recipient_profile(
                target, state, contract
            )
            if self.page.url != route:
                raise AppError(
                    "Страница Recruiter изменилась во время проверки адресата."
                )
            # The user or LinkedIn may have changed the editor while the
            # separate profile tab was loading. Re-read every guard.
            state = await self.page.evaluate(COMPOSER_JS)
        if state.get("recipient") != target["recipient_urn"]:
            raise AppError(
                "Адресат редактора Recruiter не совпадает с утверждённым профилем. Отправка остановлена."
            )
        if not state.get("valid") or state["followups"] or state["scheduled"]:
            raise AppError(
                "Проверьте редактор Recruiter: требуется одно сообщение без запланированных продолжений."
            )
        if state["subject"] or state["body"] or state["generating"]:
            raise AppError(
                "В Recruiter уже есть черновик или включён автотекст. Сохраните свой черновик и отключите автоподстановку."
            )
        return state

    async def observe(self, url, context):
        target = await self.profile(url, context["contract"])
        empty = await self.empty_history(target, context["contract"])
        if not empty:
            return {
                "inmail": False,
                "recruiter_has_history": True,
                "detail": "В Recruiter уже есть переписка с этим человеком.",
            }
        composer = await self.compose(target, context["contract"])
        channel = composer["channel"]
        credits = None
        if channel == "INMAIL_GUARD":
            match = re.fullmatch(
                r"1/([\d,\s\u00a0]+)\s+InMail Credits", composer["pricing"]
            )
            if not match:
                raise AppError("Не подтверждена стоимость платного InMail.")
            credits = int(re.sub(r"\D", "", match[1]))
        elif channel != "FREE_INMAIL":
            raise AppError(
                "Неизвестный способ оплаты Recruiter. Отправка не разрешена."
            )
        return {
            "inmail": True,
            "inmail_free": composer["channel"] == "FREE_INMAIL",
            "recruiter_target": target,
            "recruiter_composer": composer,
            "signature": composer["signature"],
            "history_verified": True,
            "credits": credits,
        }

    async def send(self, url, message, subject, context, credit_cost):
        """One approved single InMail. Caller owns cross-channel suppression."""
        if (
            not subject
            or len(subject) > 200
            or "\n" in subject
            or not message
            or len(message) > 1900
        ):
            raise AppError("Проверьте тему и текст InMail.")
        status = await self.status()
        if status["contract"] != context["contract"] or not status["manual_texts"]:
            raise AppError("Контракт или настройки текста Recruiter изменились.")
        observation = await self.observe(url, context)
        if not observation.get("inmail"):
            return {
                "sent": False,
                "retry_safe": True,
                "message": observation.get("detail", "InMail недоступен."),
            }
        state, target = (
            observation["recruiter_composer"],
            observation["recruiter_target"],
        )
        if (
            not target.get("recipient_urn")
            or state.get("recipient") != target["recipient_urn"]
        ):
            raise AppError(
                "Адресат Recruiter не подтверждён для утверждённого профиля."
            )
        cost = 0 if state["channel"] == "FREE_INMAIL" else 1
        if (
            type(credit_cost) is not int
            or credit_cost != cost
            or (
                cost
                and (observation.get("credits") is None or observation["credits"] < 1)
            )
        ):
            return {
                "sent": False,
                "retry_safe": True,
                "message": "Стоимость или остаток кредитов Recruiter изменились.",
            }
        signature = context.get("signature", "")
        if state["signature"] != signature:
            return {
                "sent": False,
                "retry_safe": True,
                "message": "Подпись Recruiter изменилась. Заново проверьте текст перед запуском.",
            }
        body = message
        if signature:
            suffix = "\n\n" + signature
            if not message.endswith(suffix):
                raise AppError("Подпись Recruiter отсутствует в утверждённом тексте.")
            body = message[: -len(suffix)]
        owner = await self.page.locator(
            '[data-view-name="messaging-composer"]'
        ).element_handle()
        expected = {
            "route": self.page.url,
            "contract": context["contract"],
            "recipient": target["recipient_urn"],
            "name": state["name"],
            "signature": signature,
            "channel": state["channel"],
            "subject": subject,
            "body": body,
        }
        pinned = await owner.evaluate(
            """(node,arg)=>{
          const subject=node.querySelector('[data-test-compose-subject-input]');
          const editor=node.querySelector('[contenteditable=true]');
          const send=node.querySelector('[data-test-messaging-submit-btn]');
          if(!subject||!editor||!send||subject.value||editor.innerText.trim())return false;
          node.__boosterRecruiter={subject,editor,send,expected:arg,clicked:false};return true;
        }""",
            expected,
        )
        if not pinned:
            return {
                "sent": False,
                "retry_safe": True,
                "message": "Редактор Recruiter занят другим черновиком.",
            }
        subject_element = await owner.query_selector(
            "[data-test-compose-subject-input]"
        )
        editor_element = await owner.query_selector("[contenteditable=true]")
        await subject_element.fill(subject)
        await editor_element.fill(body)
        submitted = False
        try:
            blocked = await before_submit_guard(self.session, self.pacer)
            if blocked:
                return {"sent": False, "retry_safe": True} | blocked
            result = await owner.evaluate(
                """(node,arg)=>{
              const p=node.__boosterRecruiter, norm=s=>(s||'').replace(/\\s+/g,' ').trim();
              if(!p||p.clicked||!node.isConnected||location.href!==arg.route)return false;
              const editors=[...node.querySelectorAll('[contenteditable=true]')];
              const subjects=[...node.querySelectorAll('[data-test-compose-subject-input]')];
              const people=[...node.querySelectorAll('[data-test-recipient-pill]')];
              const costs=[...node.querySelectorAll('[data-test-inmail-credits-text]')];
              const contract=[...new Set([...document.querySelectorAll('[data-test-user-contract-name]')].map(e=>e.textContent.trim()))];
              if(contract.length!==1||contract[0]!==arg.contract||editors.length!==1||editors[0]!==p.editor||subjects.length!==1||subjects[0]!==p.subject)return false;
              if(people.length!==1||people[0].getAttribute('data-recipient-pill-id')!==arg.recipient||people[0].innerText.trim()!==arg.name)return false;
              if(costs.length!==1||costs[0].getAttribute('data-test-inmail-credits-text')!==arg.channel)return false;
              if(arg.channel==='INMAIL_GUARD'){const m=costs[0].innerText.trim().match(/^1\\/([\\d,\\s\\u00a0]+)\\s+InMail Credits$/);if(!m||Number(m[1].replace(/\\D/g,''))<1)return false;}
              if(node.querySelectorAll('[data-test-messaging-composer]').length!==1||!node.innerText.includes('Send immediately via InMail'))return false;
              if((node.querySelector('[data-test-signature-display]')?.innerText.trim()||'')!==arg.signature)return false;
              if(p.subject.value!==arg.subject||norm(p.editor.innerText)!==norm(arg.body)||p.send.disabled||node.querySelector('[data-test-messaging-submit-btn]')!==p.send)return false;
              p.clicked=true;p.send.click();return true;
            }""",
                expected,
            )
            if result is not True:
                return {
                    "sent": False,
                    "retry_safe": True,
                    "message": "Адресат, текст или условия InMail изменились. Отправка отменена.",
                }
            submitted = True
            await self.page.wait_for_timeout(2000)
            await check_platform_limit(self.session)
            confirmed = await self.confirm(target, context, message, subject)
            return {
                "sent": confirmed,
                "retry_safe": False,
                "credit_cost": cost,
                "thread_id": self.confirmed_thread,
                "message": "InMail подтверждён в истории Recruiter."
                if confirmed
                else "Отправка выполнена, но история Recruiter ещё не подтверждена. Проверьте результат перед повтором.",
            }
        finally:
            if not submitted:
                # Clear only the exact draft this invocation owns, if still attached.
                try:
                    await owner.evaluate(
                        """(node,arg)=>{const p=node.__boosterRecruiter;if(!p||p.clicked)return;
                      if(p.subject.isConnected&&p.subject.value===arg.subject){const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(p.subject,'');p.subject.dispatchEvent(new Event('input',{bubbles:true}));}
                      if(p.editor.isConnected&&p.editor.innerText.trim()===arg.body.trim()){p.editor.innerHTML='<p><br></p>';p.editor.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'deleteContentBackward'}));}
                    }""",
                        expected,
                    )
                except Exception:
                    pass

    async def history(self, target, context):
        await self.go(target["messages_url"])
        await self.contract(context["contract"])
        pane = self.page.locator("[data-live-test-profile-messages-tab-content]")
        await pane.wait_for(state="visible", timeout=15000)
        if self.page.url.split("?")[0].rstrip("/") != target["messages_url"].split("?")[
            0
        ].rstrip("/"):
            raise AppError("История Recruiter открылась для другого профиля.")
        await pane.locator(
            "[data-test-empty-messages], [data-test-message-threads-list]"
        ).first.wait_for(state="visible", timeout=15000)
        rows = await pane.locator("[data-test-message-threads-list-item]").evaluate_all("""nodes=>nodes.map(e=>({
          href:e.querySelector('a[href]')?.href||'',
          subject:e.querySelector('[data-test-message-thread-item-subject]')?.innerText||'',
          sender:e.querySelector('[data-test-message-thread-item-sender]')?.innerText||'',
          body:e.querySelector('[data-test-message-thread-item-preview]')?.innerText||'',
          state:e.querySelector('[data-test-message-state-entity]')?.innerText||'',
          state_class:e.querySelector('.message-state-entity__text')?.className||''
        }))""")
        verified = []
        for row in rows:
            link = urlparse(row["href"])
            thread = parse_qs(link.query).get("thread", [])
            if (
                link.hostname == "www.linkedin.com"
                and link.path.rstrip("/")
                == urlparse(target["messages_url"]).path.rstrip("/")
                and len(thread) == 1
                and re.fullmatch(
                    r"urn:li:ts_candidate_message_thread:\(urn:li:ts_contract:\d+,urn:li:ts_hire_identity:\d+,urn:li:ts_prospect_comm_history:\d+\)",
                    thread[0],
                )
            ):
                row["thread_id"] = "recruiter:" + thread[0]
                verified.append(row)
        return verified

    async def thread_messages(self, target, context, row):
        await self.go(row["href"])
        await self.contract(context["contract"])
        current = urlparse(self.page.url)
        if current.path.rstrip("/") != urlparse(target["messages_url"]).path.rstrip(
            "/"
        ) or parse_qs(current.query).get("thread", []) != [
            row["thread_id"].removeprefix("recruiter:")
        ]:
            raise AppError("Recruiter открыл другую переписку.")
        rail = self.page.locator("[data-test-right-rail]")
        await rail.locator("[data-test-message-list] > li").first.wait_for(
            state="visible", timeout=15000
        )
        title = await rail.locator("[data-test-right-rail-header]").inner_text()
        if normalized(title) != normalized(row["subject"]):
            raise AppError("Не совпадает тема открытого диалога Recruiter.")
        return await rail.locator("[data-test-message-list] > li").evaluate_all("""nodes=>nodes.map(e=>({
          sender:e.querySelector('[data-test-message-list-entity-sender-name]')?.innerText||'',
          body:e.querySelector('[data-test-message-list-entity-body]')?.innerText||''
        }))""")

    async def check_reply(self, url, thread_id, context, message="", subject=""):
        target = await self.profile(url, context["contract"])
        rows = await self.history(target, context)
        matching = (
            [row for row in rows if row["thread_id"] == thread_id]
            if thread_id
            else [
                row
                for row in rows
                if subject and normalized(row["subject"]) == normalized(subject)
            ]
        )
        if len(matching) != 1:
            raise AppError(
                "Сохранённая переписка Recruiter не найдена. Проверьте её вручную."
            )
        row = matching[0]
        sender = context.get("sender_name") or normalized(row["sender"]).removeprefix(
            "from "
        )
        recipient = normalized(target["name"])
        if not recipient or recipient == normalized(sender):
            raise AppError(
                "Нельзя однозначно различить участников переписки Recruiter."
            )
        messages = await self.thread_messages(target, context, row)
        # Manual confirmation after a lost browser response may have no thread ID.
        # Recover only from the frozen subject and complete outgoing message.
        if not thread_id and not (
            message
            and context.get("sender_name")
            and any(
                normalized(m["sender"]) == normalized(context["sender_name"])
                and normalized(m["body"]) == normalized(message)
                for m in messages
            )
        ):
            raise AppError(
                "Не удалось однозначно восстановить диалог Recruiter после ручного подтверждения."
            )
        if not messages or not any(
            normalized(m["sender"]) == normalized(sender) for m in messages
        ):
            raise AppError(
                "Исходящее сообщение Recruiter не подтверждено в этом диалоге."
            )
        replies = [
            m["body"].strip()
            for m in messages
            if normalized(m["sender"]) == recipient and m["body"].strip()
        ]
        return {
            "thread_id": row["thread_id"],
            "has_reply": bool(replies),
            "reply_text": replies[-1] if replies else "",
            "detail": "Ответ найден в переписке Recruiter."
            if replies
            else "Ответ в Recruiter пока не обнаружен.",
        }

    async def confirm(self, target, context, message, subject):
        # A fresh server-loaded history, after an independently verified empty
        # history. Never infer success from a disappearing composer or toast.
        sender = (
            context.get("sender_name") or context.get("signature", "").split("\n")[0]
        )
        if not normalized(sender):
            return False
        for attempt in range(3):
            rows = await self.history(target, context)
            matches = [
                row
                for row in rows
                if normalized(row["subject"]) == normalized(subject)
                and normalized(row["body"]) == normalized(message)
                and normalized(row["sender"]) == "from " + normalized(sender)
                and normalized(row["state"])
                in {"Pending", "Sent", "Accepted", "Declined"}
            ]
            if len(matches) == 1:
                self.confirmed_thread = matches[0]["thread_id"]
                return True
            if attempt < 2:
                await self.page.wait_for_timeout(2000)
        return False

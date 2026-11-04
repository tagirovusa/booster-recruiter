"""Recognize LinkedIn's own limit notices, never infer quota from send counts."""

from .store import AppError


class LinkedInLimitError(AppError):
    """The platform explicitly refused more actions; no automatic retry."""


LIMIT_NOTICE_JS = r"""() => {
 const visible=e=>e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden';
 const patterns=[
  /(?:you(?:'|’)?ve reached|you have reached|reached your|reached the)\s+(?:your\s+|the\s+)?(?:weekly\s+)?(?:invitation|connection request|messaging|message|inmail)\s+limit/i,
  /(?:weekly\s+invitation|invitation|messaging|inmail)\s+limit\s+(?:reached|has been reached)/i,
  /(?:you can(?:not|'t|’t)|unable to)\s+send\s+(?:any\s+)?more\s+(?:invitations|connection requests|messages|inmails)\s+(?:this week|at this time|right now)/i,
  /(?:достигнут|достигли|превышен|исчерпан)[^.\n]{0,60}(?:лимит\s+(?:приглашений|сообщений|inmail)|недельн[^.\n]{0,30}лимит)/i,
  /(?:лимит\s+(?:приглашений|сообщений|inmail))[^.\n]{0,30}(?:достигнут|превышен|исчерпан)/i,
 ];
 // Notices may overlay a normal profile (<main>). Do not read profile text,
 // message history, the user's note, or a draft as evidence of a platform cap.
 for(const node of document.querySelectorAll('[role="dialog"],[role="alert"],.artdeco-toast-item')) {
  if(!visible(node))continue;
  const walker=document.createTreeWalker(node,NodeFilter.SHOW_TEXT);
  const parts=[];let item;
  while(item=walker.nextNode()) {
   const p=item.parentElement;
   if(!p||!visible(p)||p.closest('textarea,input,[contenteditable],.msg-s-event-listitem,.msg-s-event-listitem__body,[data-event-urn],[data-view-name="message-body"],script,style'))continue;
   parts.push(item.textContent);
  }
  const text=parts.join(' ').replace(/\s+/g,' ').trim();
  if(text.length<=1600&&patterns.some(p=>p.test(text)))return text.slice(0,600);
 }
 return null;
}"""


async def read_platform_limit(session):
    notice = await session.run_on_linkedin(LIMIT_NOTICE_JS)
    # Strict result type also prevents accidental truthiness from browser errors.
    if isinstance(notice, str) and notice.strip():
        return "LinkedIn сообщил о лимите: " + notice.strip()
    return None


async def check_platform_limit(session):
    notice = await read_platform_limit(session)
    if notice:
        raise LinkedInLimitError(notice)

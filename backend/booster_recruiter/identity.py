"""Resolve the signed-in member after a fresh get_my_profile navigation."""

from __future__ import annotations

import re
from urllib.parse import urlsplit

from booster_linkedin.core.exceptions import InvalidReferenceError
from booster_linkedin.linkedin.identifiers import (
    normalize_person_identifier,
    person_profile_url,
)
from patchright.async_api import Error as BrowserError

PROFILE_JS = r"""() => {
 const main=document.querySelector('main');if(!main)return {};
 const visible=e=>e.getBoundingClientRect().width>0 && e.getBoundingClientRect().height>0;
 const headings=Array.from(main.querySelectorAll('h1,h2')).filter(e=>visible(e)&&!e.closest('aside'));
 const h=headings.find(e=>e.tagName==='H1')||headings[0];if(!h)return {};
 const section=h.closest('section')||h.parentElement;
 const text=section.innerText||'';
 const paragraphs=Array.from(section.querySelectorAll('p')).filter(e=>visible(e)&&e.getBoundingClientRect().top>=h.getBoundingClientRect().bottom);
 const first=paragraphs[0]?.innerText?.trim()||'';
 const companies=Array.from(section.querySelectorAll('a[href*="/company/"]')).map(a=>(a.innerText||'').trim()).filter(Boolean);
 return {name:h.innerText.trim(),headline:first,company:companies.length===1?companies[0]:'',location:'',top_card_text:text};
}"""

# Read the address, heading and document metadata together. Recommended people
# and arbitrary /in/ links elsewhere on the page never identify the account.
OWN_PROFILE_JS = (
    """() => {
 const profile = ("""
    + PROFILE_JS
    + """)();
 return {
  url:location.href, name:profile.name||'',
  canonical:Array.from(document.head.querySelectorAll('link[rel~="canonical"]')).map(e=>e.href),
  og_url:Array.from(document.head.querySelectorAll('meta[property="og:url"]')).map(e=>e.content)
 };
}"""
)

UNRESOLVED_IDENTITY = (
    "Не удалось определить постоянную ссылку вашего LinkedIn-профиля. "
    "В окне LinkedIn откройте свой профиль, дождитесь загрузки и нажмите "
    "«Проверить вход» ещё раз. Аккаунт пока не подтверждён."
)


class IdentityResolutionError(RuntimeError):
    pass


def _profile_reference(value: str) -> str:
    """Require an actual LinkedIn profile-root URL, never a bare identifier."""
    parts = urlsplit(value)
    host = parts.hostname or ""
    if (
        parts.scheme != "https"
        or not (host == "linkedin.com" or host.endswith(".linkedin.com"))
        or parts.username is not None
        or parts.password is not None
        or parts.port not in (None, 443)
        or re.fullmatch(r"/in/[^/]+/?", parts.path) is None
    ):
        raise ValueError("Not a LinkedIn profile-root URL")
    try:
        return normalize_person_identifier(value, allow_self_alias=True)
    except InvalidReferenceError as exc:
        raise ValueError("Invalid LinkedIn profile reference") from exc


def _resolved_url(value: str) -> str | None:
    reference = _profile_reference(value)
    if reference.casefold() == "me":
        return None
    return person_profile_url(reference)


def _snapshot_identity(snapshot, reported_url):
    """Only the freshly requested own-profile document can resolve /in/me/."""
    expected = _resolved_url(reported_url)
    current = _resolved_url(snapshot["url"])
    name = str(snapshot.get("name") or "").strip()
    if not name:
        return None

    if current:
        if expected and expected != current:
            raise IdentityResolutionError(
                "Профиль в окне LinkedIn изменился во время проверки. "
                "Повторите проверку входа в нужный аккаунт."
            )
        return {"url": current, "name": name}

    # Some LinkedIn pages keep /in/me/ in the address bar. A fresh own-profile
    # document may instead state its public URL in canonical metadata. Require
    # that explicit canonical URL; og:url alone or a person's name is not enough.
    canonicals = snapshot.get("canonical") or []
    if not canonicals:
        return None
    canonical_urls = {_resolved_url(value) for value in canonicals}
    if None in canonical_urls or len(canonical_urls) != 1:
        return None
    candidate = next(iter(canonical_urls))
    for value in snapshot.get("og_url") or []:
        resolved = _resolved_url(value)
        if resolved is not None and resolved != candidate:
            return None
    if expected and candidate != expected:
        raise IdentityResolutionError(
            "Данные профиля LinkedIn расходятся. Повторите проверку входа."
        )
    return {"url": candidate, "name": name}


async def resolve_own_profile(session, reported_url: str, *, timeout: float = 15):
    """Wait for a stable public identity; never save the account as `me`.

    The caller must just have called get_my_profile in this same browser.
    No saved account identity or unrelated page links are used as a fallback.
    """
    try:
        _profile_reference(reported_url)
    except (ValueError, TypeError) as exc:
        raise IdentityResolutionError(UNRESOLVED_IDENTITY) from exc
    deadline = session.monotonic() + timeout
    previous = None
    await session.check_rate_limit()
    while True:
        try:
            snapshot = await session.run_on_linkedin(OWN_PROFILE_JS)
            identity = _snapshot_identity(snapshot, reported_url)
        except BrowserError as exc:
            # A redirect can destroy the document during an evaluation. Other
            # browser errors (closed window, lost connection) must still surface.
            if "Execution context was destroyed" not in str(exc):
                raise
            identity = None
        except (ValueError, KeyError, TypeError):
            identity = None
        if identity and identity == previous:
            await session.check_rate_limit()
            return identity
        if session.monotonic() >= deadline:
            raise IdentityResolutionError(UNRESOLVED_IDENTITY)
        previous = identity
        await session.delay(min(0.25, max(0, deadline - session.monotonic())))

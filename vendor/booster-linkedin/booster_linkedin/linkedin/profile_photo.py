# Adapted for Business Booster Recruiter.
"""Read a target profile's rendered avatar, including its visible frame."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from patchright.async_api import Error as PlaywrightError

from booster_linkedin.linkedin.identifiers import (
    normalize_person_identifier,
    person_profile_url,
)
from booster_linkedin.linkedin.navigation import PageNavigator
from booster_linkedin.linkedin.photo_frame_detection import detect_photo_frame
from booster_linkedin.linkedin.session import NAV_DELAY, PageSession


# innerText cannot include artwork. Generic image geometry and profile links
# bind the crop to the top-card avatar; no sidebar, banner or headline text is
# passed to the detector. Unsupported layouts deliberately produce unknown.
_PROFILE_PHOTO_JS = r"""({username}) => {
    const normalizedPath = value => {
        try {
            const url = new URL(value, location.href);
            if (!/(^|\.)linkedin\.com$/.test(url.hostname)) return null;
            return decodeURIComponent(url.pathname).replace(/\/+$/, '').toLowerCase();
        } catch { return null; }
    };
    const expected = '/in/' + username.toLowerCase();
    if (normalizedPath(location.href) !== expected)
        return {reason: 'profile_mismatch'};
    const visible = el => {
        const r = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && style.visibility !== 'hidden'
            && style.display !== 'none' && style.opacity !== '0';
    };
    const excluded = el => el.closest('aside, nav, header, footer, [role="dialog"]');
    const main = document.querySelector('main');
    if (!main) return {reason: 'profile_not_ready'};
    const headings = Array.from(main.querySelectorAll('h1, h2, h3'))
        .filter(el => visible(el) && !excluded(el));
    const heading = headings.find(el => el.tagName === 'H1') || headings[0];
    if (!heading) return {reason: 'profile_not_ready'};
    const hr = heading.getBoundingClientRect();
    const root = heading.closest('section') || main;
    const candidates = Array.from(root.querySelectorAll('img')).filter(img => {
        if (!visible(img) || excluded(img)) return false;
        const r = img.getBoundingClientRect();
        if (r.width < 64 || r.width > 512 || r.height < 64 || r.height > 512
            || r.width / r.height < .8 || r.width / r.height > 1.25
            || r.bottom > hr.top + 2 || r.left < hr.left - 40
            || r.left > hr.left + 120) return false;
        const src = img.currentSrc || img.src || '';
        if (src.includes('profile-displaybackground') || src.includes('company-logo'))
            return false;
        const link = img.closest('a[href]');
        const path = link && normalizedPath(link.href);
        if (link && path !== expected && path !== expected + '/overlay/photo') return false;
        return Boolean(link || src.includes('profile-displayphoto'));
    });
    if (candidates.length !== 1)
        return {reason: candidates.length ? 'ambiguous_photo' : 'photo_unavailable'};
    const img = candidates[0];
    if (!img.complete || !img.naturalWidth || !img.naturalHeight)
        return {reason: 'photo_not_loaded'};
    const ir = img.getBoundingClientRect();
    let crop = img;
    for (let el = img.parentElement, depth = 0; el && el !== root && depth < 5;
         el = el.parentElement, depth++) {
        const r = el.getBoundingClientRect();
        if (r.width >= ir.width && r.height >= ir.height
            && r.width <= ir.width * 1.35 && r.height <= ir.height * 1.35
            && Math.abs(r.width - r.height) <= Math.max(r.width, r.height) * .15
            && r.left <= ir.left && r.top <= ir.top
            && r.right >= ir.right && r.bottom >= ir.bottom) crop = el;
    }
    const r = crop.getBoundingClientRect();
    if (r.x < 0 || r.y < 0 || r.right > innerWidth || r.bottom > innerHeight)
        return {reason: 'photo_outside_viewport'};
    // Refuse an obscured photo (e.g. an intervening modal). Checking its centre
    // does not rely on the locale of the overlay's close button.
    const top = document.elementFromPoint(ir.x + ir.width / 2, ir.y + ir.height / 2);
    if (!top || !(crop.contains(top) || top.contains(crop)))
        return {reason: 'photo_obscured'};
    const labels = [];
    const add = (source, text) => { if (text && text.trim()) labels.push({source, text: text.trim()}); };
    add('image_alt', img.getAttribute('alt'));
    add('image_aria_label', img.getAttribute('aria-label'));
    for (let el = img.parentElement; el && crop.contains(el); el = el.parentElement) {
        add('photo_control_aria_label', el.getAttribute('aria-label'));
        if (el === crop) break;
    }
    return {
        reason: 'photo_captured', display_name: heading.innerText.trim(),
        locale: document.documentElement.lang || 'en', labels,
        identity: img.currentSrc || img.src,
        clip: {x: r.x, y: r.y, width: r.width, height: r.height}
    };
}"""


class ProfilePhotoReader:
    """Own one profile navigation and bounded, read-only avatar capture."""

    def __init__(self, session: PageSession, navigator: PageNavigator):
        self._session = session
        self._navigator = navigator

    async def get_profile_photo_frame(
        self, username: str
    ) -> tuple[dict[str, Any], bytes | None]:
        username = normalize_person_identifier(username)
        url = person_profile_url(username)
        await self._navigator._navigate_to_page(url)
        await self._session.delay(NAV_DELAY)
        await self._session.check_rate_limit()
        await self._session.run_on_linkedin("() => window.scrollTo(0, 0)")
        png: bytes | None = None
        snapshot: dict[str, Any] = {}
        for attempt in range(4):
            snapshot = await self._session.run_on_linkedin(
                _PROFILE_PHOTO_JS, {"username": username}
            )
            if (
                snapshot.get("reason")
                not in {"profile_not_ready", "photo_not_loaded", "photo_unavailable"}
                or attempt == 3
            ):
                break
            await self._session.delay(0.5)
        if snapshot.get("clip"):
            try:
                # A replacement page or moved avatar must not be attributed to
                # the requested person, even when a screenshot itself succeeds.
                with self._navigator._watching_navigations() as hops:
                    png = await self._session.page.screenshot(
                        type="png", clip=snapshot["clip"], timeout=5000
                    )
                    after = await self._session.run_on_linkedin(
                        _PROFILE_PHOTO_JS, {"username": username}
                    )
                if hops or any(
                    after.get(key) != snapshot.get(key)
                    for key in ("identity", "clip", "labels", "display_name")
                ):
                    png = None
                    snapshot = {"reason": "photo_changed_during_capture"}
            except PlaywrightError:
                png = None
                snapshot = {"reason": "photo_capture_failed"}
        await self._session.check_rate_limit()
        if png is None:
            frame: dict[str, Any] = {
                "status": "unknown",
                "reason": snapshot.get("reason", "photo_unavailable"),
                "method": "none",
                "evidence": [],
            }
        else:
            frame = await detect_photo_frame(
                png, snapshot.get("labels", []), locale=snapshot.get("locale", "en")
            )
        frame.update(
            image_available=png is not None,
            needs_visual_review=frame["status"] == "unknown" and png is not None,
            observed_at=datetime.now(timezone.utc).isoformat(),
        )
        return {
            "url": url,
            "sections": {},
            "display_name": snapshot.get("display_name"),
            "photo_frame": frame,
        }, png

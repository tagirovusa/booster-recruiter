"""Conservative, local recognition of explicitly labelled profile-photo frames.

The caller supplies labels from the verified target avatar and a crop of that
avatar, not arbitrary page text. A missing label or unreadable photo never
establishes that the person is unavailable for work.
"""

from __future__ import annotations

import asyncio
import json
import math
import os
from pathlib import Path
import platform
import re
import shutil
import tempfile
from typing import Any
import unicodedata


_OCR_TIMEOUT_SECONDS = 45.0
_MIN_OCR_CONFIDENCE = 0.80
_MAX_PNG_BYTES = 8 * 1024 * 1024
_LABEL_SOURCES = {
    "image_alt",
    "image_aria_label",
    "photo_control_aria_label",
}

# These are literal English artwork words, not translated UI controls. Text is
# the only signal this detector uses: unknown locales have no prose fallback.
# The hashtag artwork is recognisable in any interface language; untagged
# phrases are deliberately restricted to this explicit language table.
_ARTWORK_MARKERS = {"#opentowork": "open_to_work", "#hiring": "hiring"}
_LOCALE_PHRASES = {
    "en": {"open to work": "open_to_work", "opentowork": "open_to_work"},
}
_OCR_LOCALE_PHRASES = {
    "en": {
        **_LOCALE_PHRASES["en"],
        "hiring": "hiring",
    },
}


def _normalized(text: str) -> str:
    return " ".join(unicodedata.normalize("NFKC", text).casefold().split())


def _artwork_status(text: str) -> str | None:
    # A whole artwork token, not a substring of a name, slogan, or negation.
    compact = re.sub(r"[\s_]", "", _normalized(text))
    return _ARTWORK_MARKERS.get(compact)


def _label_status(text: str, locale: str) -> str | None:
    normalized = _normalized(text)
    direct = _artwork_status(normalized)
    if direct:
        return direct
    # LinkedIn can append a frame tag to an image's accessible name. Only a
    # final comma-delimited hashtag qualifies; arbitrary prose is not a label.
    if "," in normalized:
        suffix = normalized.rsplit(",", 1)[1].strip()
        if status := _artwork_status(suffix):
            return status
    return _LOCALE_PHRASES.get(locale, {}).get(normalized)


def _result(
    status: str, reason: str, method: str, evidence: list[dict[str, Any]]
) -> dict[str, Any]:
    return {
        "status": status,
        "reason": reason,
        "method": method,
        "evidence": evidence,
    }


async def _run_local_ocr(png: bytes) -> tuple[list[dict[str, Any]], str | None]:
    """Run Apple's on-device Vision with no upload or persistent image files."""
    swift = shutil.which("swift") if platform.system() == "Darwin" else None
    helper = Path(__file__).with_name("photo_frame_ocr.swift")
    if not swift or not helper.is_file():
        return [], "local_ocr_unavailable"
    process: asyncio.subprocess.Process | None = None
    try:
        with tempfile.TemporaryDirectory(prefix="linkedin-photo-frame-") as scratch:
            image = Path(scratch) / "avatar.png"
            image.write_bytes(png)
            # Keep both the input and compiler caches inside the disposable
            # directory. Cancellation must reap Swift before removing them.
            env = os.environ.copy()
            env["CLANG_MODULE_CACHE_PATH"] = str(Path(scratch) / "modules")
            process = await asyncio.create_subprocess_exec(
                swift,
                "-module-cache-path",
                str(Path(scratch) / "modules"),
                str(helper),
                str(image),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=env,
            )
            try:
                stdout, _ = await asyncio.wait_for(
                    process.communicate(), timeout=_OCR_TIMEOUT_SECONDS
                )
            finally:
                if process.returncode is None:
                    process.kill()
                    await process.wait()
            if process.returncode != 0:
                return [], "local_ocr_failed"
            payload = json.loads(stdout)
            if not isinstance(payload, dict) or not isinstance(
                payload.get("observations"), list
            ):
                return [], "local_ocr_failed"
            observations = [
                observation
                for observation in payload["observations"][:64]
                if isinstance(observation, dict)
            ]
            return observations, None
    except TimeoutError:
        return [], "local_ocr_timeout"
    except (OSError, ValueError):
        return [], "local_ocr_failed"


async def detect_photo_frame(
    png: bytes | None,
    labels: list[dict[str, str]],
    *,
    locale: str = "en",
) -> dict[str, Any]:
    """Identify an explicit frame label; otherwise retain an unknown status.

    Labels must belong to the exact selected avatar. On macOS the optional
    PNG is read with local Vision OCR, restricted to the avatar's outer ring.
    Elsewhere the caller can return the image for a multimodal client to read.
    This detects visible declarations, never current employment or hidden
    recruiter-only settings. Image colours are not classification evidence.
    """
    locale = locale.casefold().replace("_", "-").split("-", 1)[0]
    evidence: list[dict[str, Any]] = []
    statuses: set[str] = set()
    for label in labels:
        source, text = label.get("source"), label.get("text")
        if source not in _LABEL_SOURCES or not isinstance(text, str):
            continue
        if status := _label_status(text, locale):
            statuses.add(status)
            evidence.append({"source": source, "text": text[:500]})
    if len(statuses) > 1:
        return _result("unknown", "conflicting_labels", "accessible_label", evidence)
    if statuses:
        return _result(
            statuses.pop(), "explicit_avatar_label", "accessible_label", evidence
        )
    if not png:
        return _result("unknown", "photo_unavailable", "none", [])
    if len(png) > _MAX_PNG_BYTES or not png.startswith(b"\x89PNG\r\n\x1a\n"):
        return _result("unknown", "invalid_photo", "none", [])

    observations, error = await _run_local_ocr(png)
    if error:
        return _result("unknown", error, "none", [])
    for observation in observations:
        text = observation.get("text")
        confidence = observation.get("confidence")
        if (
            not isinstance(text, str)
            or not isinstance(confidence, (int, float))
            or isinstance(confidence, bool)
            or not math.isfinite(confidence)
            or not _MIN_OCR_CONFIDENCE <= confidence <= 1
            or observation.get("region") != "avatar_perimeter"
        ):
            continue
        status = _artwork_status(text) or _OCR_LOCALE_PHRASES.get(locale, {}).get(
            _normalized(text)
        )
        if status:
            statuses.add(status)
            evidence.append(
                {
                    "source": "local_ocr",
                    "text": text[:100],
                    "confidence": confidence,
                    "region": "avatar_perimeter",
                }
            )
    if len(statuses) > 1:
        return _result("unknown", "conflicting_labels", "local_ocr", evidence)
    if statuses:
        return _result(statuses.pop(), "explicit_perimeter_text", "local_ocr", evidence)
    return _result("unknown", "no_readable_frame_label", "local_ocr", [])

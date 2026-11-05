"""Turn internal failures into short Russian sentences for the recruiter.

Technical text (English library messages, JSON, file paths, tracebacks) never
reaches the interface. It is appended to a local ``errors.log`` instead, so a
developer can still see what happened.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from pathlib import Path

GENERIC = "Не удалось выполнить действие. Попробуйте ещё раз через минуту; если ошибка повторится, перезапустите приложение — данные сохранятся."
BROWSER_CLOSED = "Браузер LinkedIn неожиданно закрылся. Запустите действие ещё раз — приложение откроет браузер заново."
BROWSER_TIMEOUT = (
    "LinkedIn не ответил вовремя. Проверьте интернет и запустите действие ещё раз."
)
NETWORK = "Нет связи с LinkedIn. Проверьте интернет и запустите действие ещё раз."
PAGE_CHANGED = "Страница LinkedIn выглядит не так, как ожидалось. Действие остановлено; попробуйте позже."
BAD_PROFILE_LINK = "Ссылка на профиль LinkedIn не распознана. Вставьте полную ссылку вида https://www.linkedin.com/in/…"

_LOG: Path | None = None
_LOG_LIMIT = 512 * 1024

_CYRILLIC = re.compile(r"[А-Яа-яЁё]")
_TECHNICAL = re.compile(
    r"(\{\s*\"|Traceback|\bFile \"|/" r"Users/|[A-Za-z]:\\|https?://(?!www\.linkedin\.com/in/)|"
    r"Diagnostics:|NoneType|object is not|Error:|Exception|\bline \d+)",
)

# Ordered: first match wins. Patterns are matched case-insensitively against
# the raw English text from the browser engine or the LinkedIn adapter.
_KNOWN = [
    (
        r"browser (stopped|closed|has been closed|crashed)|target (page, context or browser )?(closed|crashed)|"
        r"browser process (exited|terminated)|connection closed",
        BROWSER_CLOSED,
    ),
    (r"timeout \d+ ?ms exceeded|timed out|timeout exceeded", BROWSER_TIMEOUT),
    (
        r"net::err_|name not resolved|internet_disconnected|connection (refused|reset)|"
        r"network is unreachable|getaddrinfo",
        NETWORK,
    ),
    (
        r"not a linkedin public identifier|invalid (profile )?(url|reference)",
        BAD_PROFILE_LINK,
    ),
    (
        r"selector|locator|element (is )?not (found|visible|attached)|waiting for",
        PAGE_CHANGED,
    ),
]


def configure(root: Path) -> None:
    """Store raw failures next to the workspace database."""
    global _LOG
    _LOG = Path(root) / "errors.log"


def record(raw: str) -> None:
    if not _LOG or not raw:
        return
    try:
        if _LOG.exists() and _LOG.stat().st_size > _LOG_LIMIT:
            _LOG.replace(_LOG.with_suffix(".log.1"))
        with _LOG.open("a", encoding="utf-8") as stream:
            stamp = datetime.now(timezone.utc).isoformat(timespec="seconds")
            stream.write(f"{stamp} {raw.strip()[:4000]}\n")
    except OSError:
        pass


def is_user_text(text: str) -> bool:
    """A Russian sentence without technical fragments can be shown as is."""
    return bool(text) and bool(_CYRILLIC.search(text)) and not _TECHNICAL.search(text)


def user_text(raw: object, fallback: str = GENERIC, *, log: bool = True) -> str:
    text = str(raw or "").strip()
    if is_user_text(text):
        return text[:600]
    if log:
        record(text)
    lowered = text.casefold()
    for pattern, message in _KNOWN:
        if re.search(pattern, lowered):
            return message
    # Russian prefix followed by technical details ("…: {json}") keeps the
    # readable part only.
    head = re.split(r"[:{\n]", text, maxsplit=1)[0].strip()
    if is_user_text(head) and len(head) > 15:
        return head.rstrip(".") + "."
    return fallback


def shown(text, fallback: str = GENERIC):
    """Clean a stored status line on display; empty values stay empty."""
    return user_text(text, fallback, log=False) if text else text

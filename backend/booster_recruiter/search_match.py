"""Local check that a found profile really matches the campaign query.

LinkedIn people search is fuzzy: it may return profiles where the words occur
in fields the app cannot read, or not at all. Before a profile is saved, the
same keyword query is evaluated against the text the app actually read.

Supported syntax mirrors LinkedIn: "quoted phrases", AND, OR, NOT, brackets,
and implicit AND between neighbouring terms. Words are compared case-blind
after light English suffix stripping, so "Driver Recruiting" satisfies
"driver recruiter" and "trucking" satisfies "truck".
"""

from __future__ import annotations

import re
from dataclasses import dataclass

_WORD = re.compile(r"[0-9A-Za-zÀ-ÖØ-öø-ÿА-Яа-яЁё]+(?:[+#]+)?")
_TOKEN = re.compile(r'"([^"]*)"|(\()|(\))|([^\s()"]+)')
_SUFFIXES = (
    "ments",
    "ment",
    "ings",
    "ing",
    "ers",
    "er",
    "ors",
    "or",
    "ied",
    "ies",
    "ed",
    "es",
    "s",
)


def _stem(word: str) -> str:
    word = word.lower().replace("ё", "е")
    if not word.isascii() or len(word) <= 3:
        return word
    for suffix in _SUFFIXES:
        if word.endswith(suffix) and len(word) - len(suffix) >= 3:
            word = word[: -len(suffix)]
            break
    # "driv-e" and "driv-ing" meet at the same stem.
    if word.endswith("e") and len(word) > 3:
        word = word[:-1]
    return word


def words(text: str) -> list[str]:
    return [_stem(w) for w in _WORD.findall(text or "")]


@dataclass(frozen=True)
class _Phrase:
    stems: tuple[str, ...]


class _Parser:
    def __init__(self, query: str):
        self.items: list[object] = []
        for quoted, opening, closing, bare in _TOKEN.findall(query):
            if opening:
                self.items.append("(")
            elif closing:
                self.items.append(")")
            elif bare and bare.upper() in {"AND", "OR", "NOT"}:
                self.items.append(bare.upper())
            else:
                stems = tuple(words(quoted if quoted else bare))
                if stems:
                    self.items.append(_Phrase(stems))
        self.pos = 0

    def peek(self):
        return self.items[self.pos] if self.pos < len(self.items) else None

    def take(self):
        item = self.peek()
        self.pos += 1
        return item

    def parse(self):
        node = self.or_expr()
        if self.peek() is not None:
            raise ValueError("unbalanced query")
        return node

    def or_expr(self):
        nodes = [self.and_expr()]
        while self.peek() == "OR":
            self.take()
            nodes.append(self.and_expr())
        return ("or", nodes) if len(nodes) > 1 else nodes[0]

    def and_expr(self):
        nodes = [self.not_expr()]
        while True:
            nxt = self.peek()
            if nxt == "AND":
                self.take()
                nodes.append(self.not_expr())
            elif nxt is not None and nxt not in {"OR", ")"}:
                nodes.append(self.not_expr())  # implicit AND
            else:
                break
        return ("and", nodes) if len(nodes) > 1 else nodes[0]

    def not_expr(self):
        if self.peek() == "NOT":
            self.take()
            return ("not", self.not_expr())
        return self.atom()

    def atom(self):
        item = self.take()
        if item == "(":
            node = self.or_expr()
            if self.take() != ")":
                raise ValueError("unbalanced query")
            return node
        if isinstance(item, _Phrase):
            return item
        raise ValueError("unexpected token")


def _contains(haystack: tuple[str, ...], needle: tuple[str, ...]) -> bool:
    n = len(needle)
    return any(haystack[i : i + n] == needle for i in range(len(haystack) - n + 1))


def _evaluate(node, text: tuple[str, ...]) -> bool:
    if isinstance(node, _Phrase):
        return _contains(text, node.stems)
    kind, value = node
    if kind == "or":
        return any(_evaluate(n, text) for n in value)
    if kind == "and":
        return all(_evaluate(n, text) for n in value)
    return not _evaluate(value, text)


def compile_query(query: str):
    """Return a parsed query, or None when the query cannot be checked."""
    try:
        parser = _Parser(query or "")
        if not parser.items:
            return None
        return parser.parse()
    except (ValueError, IndexError):
        return None


def profile_text(person: dict) -> str:
    parts = [
        person.get("name", ""),
        person.get("headline", ""),
        person.get("company", ""),
        person.get("location", ""),
        person.get("top_card_text", ""),
    ]
    for key, value in (person.get("sections") or {}).items():
        # LinkedIn's "People also viewed" and similar blocks on the main page
        # describe other people; they are cut off where they begin.
        if key == "main_profile":
            value = _own_part(value)
        parts.append(value if isinstance(value, str) else "")
    return "\n".join(p for p in parts if isinstance(p, str))


_SIDEBAR = re.compile(
    r"\n(?:Explore Premium profiles|People also viewed|More profiles for you|"
    r"People you may know|You might like|Other similar profiles)\b"
)


def _own_part(text: str) -> str:
    if not isinstance(text, str):
        return ""
    cut = _SIDEBAR.search(text)
    return text[: cut.start()] if cut else text


def matches(query, person: dict) -> bool:
    """True when the parsed query holds for the person's own profile text."""
    if query is None:
        return True
    return _evaluate(query, tuple(words(profile_text(person))))

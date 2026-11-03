import pytest
from booster_recruiter.identity import IdentityResolutionError, resolve_own_profile
from booster_recruiter.store import Store, canonical
from patchright.async_api import Error as BrowserError

ALIAS = "https://www.linkedin.com/in/me/"
REAL = "https://www.linkedin.com/in/test-recruiter"
OTHER = "https://www.linkedin.com/in/another-person"


def snapshot(url=ALIAS, *, name="Test Recruiter", canonical_urls=(), og_urls=()):
    return {"url": url, "name": name, "canonical": canonical_urls, "og_url": og_urls}


class Session:
    """Virtual clock and document snapshots; no LinkedIn or actual waiting."""

    def __init__(self, *snapshots):
        self.snapshots = list(snapshots)
        self.time = 0
        self.checks = 0

    def monotonic(self):
        return self.time

    async def delay(self, seconds):
        self.time += seconds

    async def check_rate_limit(self):
        self.checks += 1

    async def run_on_linkedin(self, _script):
        value = self.snapshots[0]
        if len(self.snapshots) > 1:
            self.snapshots.pop(0)
        if isinstance(value, Exception):
            raise value
        return value


async def test_stale_mcp_alias_resolves_from_later_redirect_and_saves(tmp_path):
    # The original bug: the MCP returned /in/me/ even though the browser
    # subsequently resolved the redirect. Store correctly refused that alias.
    with pytest.raises(Exception, match="alias for the signed-in member"):
        canonical(ALIAS)
    session = Session(snapshot(), snapshot(REAL + "/?trk=own-profile"))
    identity = await resolve_own_profile(session, ALIAS)
    assert identity == {"url": REAL, "name": "Test Recruiter"}
    assert session.time >= 0.5 and session.checks == 2
    store = Store(tmp_path)
    try:
        account = store.create_account("Account")
        saved = store.set_account(account["id"], "ready", **identity)
        assert saved["status"] == "ready" and saved["url"] == REAL
    finally:
        store.db.close()


async def test_alias_page_can_identify_itself_with_canonical_metadata():
    session = Session(snapshot(canonical_urls=[REAL + "/"], og_urls=[REAL]))
    assert (await resolve_own_profile(session, ALIAS))["url"] == REAL


async def test_redirect_during_evaluation_is_retried():
    session = Session(
        BrowserError(
            "Execution context was destroyed, most likely because of a navigation"
        ),
        snapshot(REAL),
    )
    assert (await resolve_own_profile(session, ALIAS))["url"] == REAL


async def test_closed_browser_is_not_hidden_as_an_identity_timeout():
    session = Session(BrowserError("Target page has been closed"))
    with pytest.raises(BrowserError, match="closed"):
        await resolve_own_profile(session, ALIAS)


@pytest.mark.parametrize(
    "document",
    [
        snapshot(),
        snapshot(REAL, name=""),
        snapshot(og_urls=[REAL]),
        snapshot(canonical_urls=[ALIAS]),
        snapshot(canonical_urls=[REAL, OTHER]),
        snapshot(canonical_urls=[REAL], og_urls=[OTHER]),
        snapshot(canonical_urls=["https://linkedin.com.example.net/in/recruiter"]),
        snapshot(canonical_urls=["https://www.linkedin.com/in/%2e%2e"]),
        snapshot("https://www.linkedin.com/login", canonical_urls=[REAL]),
        snapshot("https://www.linkedin.com/feed/", canonical_urls=[REAL]),
        snapshot(
            "https://www.linkedin.com/in/me/details/experience/", canonical_urls=[REAL]
        ),
    ],
)
async def test_unknown_or_conflicting_identity_stays_unconfirmed(document):
    session = Session(document)
    with pytest.raises(IdentityResolutionError, match="Аккаунт пока не подтверждён"):
        await resolve_own_profile(session, ALIAS, timeout=0.5)
    assert session.time == 0.5


@pytest.mark.parametrize("reported", ["me", "https://example.net/in/person", ""])
async def test_invalid_mcp_result_is_never_accepted(reported):
    with pytest.raises(IdentityResolutionError):
        await resolve_own_profile(Session(snapshot(REAL)), reported)


async def test_a_profile_change_during_check_is_refused():
    with pytest.raises(IdentityResolutionError, match="изменился"):
        await resolve_own_profile(Session(snapshot(OTHER)), REAL)


async def test_transient_profile_is_not_saved_before_next_snapshot():
    session = Session(snapshot(OTHER), snapshot(REAL))
    assert (await resolve_own_profile(session, ALIAS))["url"] == REAL
    assert session.time == 0.5


async def test_own_profile_check_preserves_checkpoint_errors():
    session = Session(snapshot(REAL))

    async def checkpoint():
        raise RuntimeError("checkpoint required")

    session.check_rate_limit = checkpoint
    with pytest.raises(RuntimeError, match="checkpoint"):
        await resolve_own_profile(session, ALIAS)

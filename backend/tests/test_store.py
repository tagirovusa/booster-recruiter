import io

import pytest
from booster_recruiter.store import AppError, Store, message_for
from openpyxl import load_workbook


@pytest.fixture
def store(tmp_path):
    s = Store(tmp_path)
    yield s
    s.db.close()


def prepared(s, name="Alice Example", url="alice-example"):
    a = s.create_account("Recruiter")
    s.set_account(a["id"], "ready", "https://www.linkedin.com/in/recruiter")
    c = s.create_campaign(
        {
            "name": "Hiring",
            "account_id": a["id"],
            "keywords": "CDL recruiter",
            "max_profiles": 20,
            "template_open": "Hello {first_name}, open opportunity.",
            "template_neutral": "Hello {first_name}, opportunity.",
        }
    )
    s.add_candidate(
        c["id"], {"url": url, "name": name, "photo_frame": {"status": "open_to_work"}}
    )
    p = s.detail(c["id"])["candidates"][0]
    s.review(p["id"], "open", True)
    return a, c, p


def test_exact_account_recipient_and_message_are_frozen(store):
    a, c, p = prepared(store)
    preview = store.preview(c["id"])
    assert preview["account"]["id"] == a["id"]
    assert preview["messages"][0]["url"] == "https://www.linkedin.com/in/alice-example"
    assert preview["messages"][0]["message"] == "Hello Alice, open opportunity."
    assert store.claim(preview["batch_id"]) is None
    store.approve(preview["batch_id"], preview["digest"])
    attempt = store.claim(preview["batch_id"])
    assert attempt["message"] == preview["messages"][0]["message"]
    assert store.claim(preview["batch_id"]) is None


def test_template_edit_invalidates_previous_approval(store):
    _, c, _ = prepared(store)
    p = store.preview(c["id"])
    store.templates(c["id"], "Different text", "Different neutral")
    with pytest.raises(AppError, match="устарел"):
        store.approve(p["batch_id"], p["digest"])


def test_recipient_review_invalidates_previous_preview(store):
    _, c, person = prepared(store)
    p = store.preview(c["id"])
    store.review(person["id"], "neutral", True)
    with pytest.raises(AppError):
        store.approve(p["batch_id"], p["digest"])


@pytest.mark.parametrize("status", ["sent", "unknown", "replied"])
def test_contact_history_blocks_duplicates_across_accounts(store, status):
    _, c, _ = prepared(store)
    p = store.preview(c["id"])
    store.approve(p["batch_id"], p["digest"])
    row = store.claim(p["batch_id"])
    store.finish(row["id"], status)
    _, other, _ = prepared(store)
    with pytest.raises(AppError, match="Нет выбранных"):
        store.preview(other["id"])


def test_cross_batch_claim_blocks_contact_race(store):
    _, a, _ = prepared(store)
    _, b, _ = prepared(store)
    pa, pb = store.preview(a["id"]), store.preview(b["id"])
    store.approve(pa["batch_id"], pa["digest"])
    store.approve(pb["batch_id"], pb["digest"])
    assert store.claim(pa["batch_id"])["url"].endswith("alice-example")
    assert store.claim(pb["batch_id"]) == {"skip": True}


def test_restart_marks_inflight_unknown_without_automatic_retry(tmp_path):
    s = Store(tmp_path)
    _, c, _ = prepared(s)
    p = s.preview(c["id"])
    s.approve(p["batch_id"], p["digest"])
    row = s.claim(p["batch_id"])
    s.db.close()
    restored = Store(tmp_path)
    assert (
        restored.one("SELECT status FROM deliveries WHERE id=?", (row["id"],))["status"]
        == "unknown"
    )
    assert restored.claim(p["batch_id"]) is None
    restored.db.close()


@pytest.mark.parametrize("status", ["unknown", "hiring", "none", None])
def test_non_open_photo_defaults_to_neutral_without_auto_selecting(store, status):
    _, c, _ = prepared(store)
    store.add_candidate(
        c["id"],
        {
            "url": "uncertain",
            "name": "Unknown Person",
            "photo_frame": {"status": status},
        },
    )
    p = next(
        p for p in store.detail(c["id"])["candidates"] if p["url"].endswith("uncertain")
    )
    assert p["segment"] == "neutral" and not p["selected"]
    store.review(p["id"], "neutral", True)
    preview = store.preview(c["id"])
    message = next(x for x in preview["messages"] if x["url"].endswith("uncertain"))
    assert message["message"] == "Hello Unknown, opportunity."
    with pytest.raises(AppError):
        store.review(p["id"], "review", True)


def test_neutral_migration_preserves_manual_review_and_runs_once(tmp_path):
    s = Store(tmp_path)
    _, c, _ = prepared(s)
    for url in ("automatic", "manual"):
        s.add_candidate(c["id"], {"url": url, "name": url})
    manual = next(
        p for p in s.detail(c["id"])["candidates"] if p["data"]["name"] == "manual"
    )
    s.review(manual["id"], "review", False)
    with s.db:
        s.db.execute(
            "UPDATE candidates SET segment='review' WHERE url LIKE '%/automatic'"
        )
        s.db.execute("DELETE FROM migrations WHERE name='0.1.3-neutral-default'")
    preview = s.preview(c["id"])
    s.db.close()
    s = Store(tmp_path)
    rows = {p["data"]["name"]: p for p in s.detail(c["id"])["candidates"]}
    assert rows["automatic"]["segment"] == "neutral"
    assert rows["manual"]["segment"] == "review"
    assert (
        s.one("SELECT status FROM batches WHERE id=?", (preview["batch_id"],))["status"]
        == "cancelled"
    )
    s.review(rows["automatic"]["id"], "review", False)
    s.db.close()
    s = Store(tmp_path)
    assert (
        s.one("SELECT segment FROM candidates WHERE id=?", (rows["automatic"]["id"],))[
            "segment"
        ]
        == "review"
    )
    s.db.close()


def test_wrong_account_cannot_replace_identity(store):
    a = store.create_account("Sender")
    store.set_account(a["id"], "ready", "sender-a")
    store.set_account(a["id"], "ready", "sender-b")
    actual = store.account(a["id"])
    assert (
        actual["url"].endswith("sender-a") and actual["status"] == "identity_mismatch"
    )


def test_suppression_cancels_approved_pending_contact(store):
    _, c, p = prepared(store)
    batch = store.preview(c["id"])
    store.approve(batch["batch_id"], batch["digest"])
    store.suppress(p["url"], "Opt out")
    assert store.claim(batch["batch_id"]) is None


@pytest.mark.parametrize(
    "text",
    [
        "Hi {secret}",
        "Hi {name.__class__}",
        "Hi {name!r}",
        "Hi {company}",
        "Fill [link]",
        "Hi\tthere",
    ],
)
def test_invalid_templates_are_rejected_before_sending(text):
    with pytest.raises(AppError):
        message_for(text, {"name": "Alice"})


def test_missing_information_is_not_fabricated():
    with pytest.raises(AppError, match="не заполнено"):
        message_for("Your role {headline}", {"name": "Alice"})


def test_exports_keep_formula_like_profile_text_inert(store):
    _, c, _ = prepared(store, name='=HYPERLINK("https://bad.example")')
    xlsx = load_workbook(io.BytesIO(store.export(c["id"], "xlsx")))
    assert xlsx.active["A2"].data_type == "s"
    assert xlsx.active["A2"].value.startswith("=HYPERLINK")
    csv = store.export(c["id"], "csv").decode("utf-8-sig")
    assert "'=HYPERLINK" in csv


def test_same_profile_is_saved_once_despite_tracking_parameters(store):
    _, c, _ = prepared(store)
    store.add_candidate(
        c["id"],
        {"url": "https://www.linkedin.com/in/alice-example/?trk=foo", "name": "Again"},
    )
    assert len(store.detail(c["id"])["candidates"]) == 1

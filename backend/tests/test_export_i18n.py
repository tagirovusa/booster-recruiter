import csv
import io

from booster_recruiter.export_i18n import translate
from booster_recruiter.store import Store
from test_outreach import plan


def test_translate_matches_catalog_entries_templates_and_sentences():
    assert (
        translate("Проверьте спорные результаты в истории.")
        == "Review the uncertain results in the history."
    )
    assert translate("Профилей сохранено: 3.") == "Profiles saved: 3."
    # Several stored sentences are translated one by one.
    assert translate(
        "Профилей сохранено: 2. Пропущено несоответствующих запросу: 1."
    ) == ("Profiles saved: 2. Skipped as not matching the query: 1.")
    # Unknown text and non-text values are kept as they are.
    assert translate("Совсем неизвестный текст.") == "Совсем неизвестный текст."
    assert translate("") == ""
    assert translate(None) is None


def test_english_export_translates_stored_comments_and_reasons(tmp_path):
    store = Store(tmp_path)
    try:
        _, c, _, preview = plan(store)
        run = store.outreach.approve(preview["run_id"], preview["digest"])
        member = store.outreach.members(run["id"])[0]
        action = store.outreach.reserve(member["id"], "invite")
        store.outreach.finish(action, "sent", "Проверьте спорные результаты в истории.")
        store.outreach.update_member(
            member["id"], detail="Проверьте спорные результаты в истории."
        )

        english = store.export(c["id"], "csv", "en").decode("utf-8-sig")
        row = next(csv.DictReader(io.StringIO(english)))
        assert row["Comment"] == "Review the uncertain results in the history."

        from openpyxl import load_workbook

        book = load_workbook(io.BytesIO(store.export(c["id"], "xlsx", "en")))
        history = book["Outreach history"]
        header = [cell.value for cell in history[1]]
        reasons = [
            dict(zip(header, (cell.value for cell in r)))["Reason"]
            for r in history.iter_rows(min_row=2)
        ]
        assert "Review the uncertain results in the history." in reasons

        # The Russian export keeps the stored text.
        russian = store.export(c["id"], "csv", "ru").decode("utf-8-sig")
        assert "Проверьте спорные результаты в истории." in russian
    finally:
        store.db.close()

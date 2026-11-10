"""Synthetic desktop acceptance data; this script never opens LinkedIn."""

import sys
from pathlib import Path

from booster_recruiter.store import Store

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend" / "tests"))
from legacy_history import legacy_approve, legacy_claim, legacy_preview  # noqa: E402


def seed(data: Path):
    # Keep this helper away from a real workspace even if run by hand.
    # The interface language preference may be written first by the UI test.
    if not data.name.startswith("booster-ui-") or any(
        p.name != "desktop-preferences.json" for p in data.iterdir()
    ):
        raise ValueError("Use an empty booster-ui-* temporary directory.")
    store = Store(data)
    try:
        account = store.create_account("Демо · команда подбора")
        store.set_account(account["id"], "ready", "demo-recruiter")

        def campaign(name):
            return store.create_campaign(
                {
                    "name": name,
                    "account_id": account["id"],
                    "keywords": '"driver recruitment" manager',
                    "max_profiles": 20,
                    "template_open": "Hi {first_name}, I noticed you are open to opportunities. Let us discuss a remote recruitment role.",
                    "template_neutral": "Hi {first_name}, would you be interested in discussing a remote recruitment role?",
                }
            )

        def candidate(cid, name, slug, status="unknown"):
            store.add_candidate(
                cid,
                {
                    "url": slug,
                    "name": name,
                    "headline": "Recruitment operations · US trucking",
                    "photo_frame": {"status": status},
                    "sections": {
                        "main_profile": "Example profile for interface testing."
                    },
                },
            )
            # Query by URL instead of depending on candidate ordering.
            person = next(
                p
                for p in store.detail(cid)["candidates"]
                if p["url"].endswith("/" + slug)
            )
            store.review(person["id"], "neutral", True)
            return person

        demo = campaign("Head of Recruitment · пример")
        for name, slug, status in [
            ("Alex Morgan", "demo-alex", "open_to_work"),
            ("Sam Taylor", "demo-sam", "unknown"),
            ("Jamie Reed", "demo-jamie", "hiring"),
        ]:
            store.add_candidate(
                demo["id"],
                {
                    "url": slug,
                    "name": name,
                    "headline": "Recruitment operations · US trucking",
                    "photo_frame": {"status": status},
                    "sections": {
                        "main_profile": "Example profile for interface testing."
                    },
                },
            )
        store.progress(
            demo["id"],
            "ready",
            "Демонстрационные данные для проверки интерфейса. Сообщения не отправляются.",
        )
        campaign("История · без обращений")

        # LinkedIn ran out of results for this query before the limit.
        exhausted = campaign("Поиск · больше не находит")
        candidate(exhausted["id"], "Riley Brooks", "demo-riley")
        store.mark_search_exhausted(exhausted["id"], exhausted["keywords"])

        for label, outreach, legacy in [
            ("История · автоматизация", True, False),
            ("История · сообщения", False, True),
            ("История · вместе", True, True),
        ]:
            item = campaign(label)
            cid = item["id"]
            if legacy:
                person = candidate(cid, "Taylor Parker", cid + "-legacy")
                plan = legacy_preview(store, cid)
                legacy_approve(store, plan["batch_id"], plan["digest"])
                delivery = legacy_claim(store, plan["batch_id"])
                assert delivery and not delivery.get("skip")
                store.finish(
                    delivery["id"],
                    "unknown",
                    "Демонстрация результата, который требует ручной проверки.",
                )
                store.review(person["id"], "neutral", False)
            if outreach:
                candidate(cid, "Casey Rowan", cid + "-invite")
                candidate(cid, "Jordan Lee", cid + "-reply")
                plan = store.outreach.preview(cid)
                store.outreach.approve(plan["run_id"], plan["digest"])
                for member in store.outreach.members(plan["run_id"]):
                    invite = member["name"] == "Casey Rowan"
                    action = store.outreach.reserve(
                        member["id"], "invite" if invite else "message"
                    )
                    store.outreach.finish(action, "sent", "Демонстрационный результат.")
                    store.outreach.update_member(
                        member["id"],
                        status="waiting_acceptance" if invite else "replied",
                        detail="Ожидаем принятия приглашения."
                        if invite
                        else "Ответ получен, дальнейшие обращения остановлены.",
                        reply_text="" if invite else "Спасибо за сообщение.",
                    )
                store.outreach.status(
                    plan["run_id"], "paused", "Изолированный тест интерфейса."
                )
    finally:
        store.db.close()


if __name__ == "__main__":
    seed(Path(sys.argv[1]))

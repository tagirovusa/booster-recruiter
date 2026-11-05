"""Recruiters can rename, resize, archive and remove their own campaigns."""

import pytest
from booster_recruiter.store import AppError, Store
from test_store import prepared


@pytest.fixture
def store(tmp_path):
    s = Store(tmp_path)
    yield s
    s.db.close()


def test_rename_and_raise_the_profile_limit(store):
    _, c, _ = prepared(store)
    updated = store.update_campaign(
        c["id"], {"name": "Водители CDL", "max_profiles": 60}
    )
    assert updated["name"] == "Водители CDL"
    assert updated["max_profiles"] == 60
    with pytest.raises(AppError, match="от 1 до 100"):
        store.update_campaign(c["id"], {"max_profiles": 500})


def test_search_is_fixed_once_profiles_exist(store):
    _, c, _ = prepared(store)
    with pytest.raises(AppError, match="запрос изменить нельзя"):
        store.update_campaign(c["id"], {"keywords": "other"})
    empty = store.create_campaign(
        {
            "name": "Пусто",
            "account_id": c["account_id"],
            "keywords": "a",
            "max_profiles": 5,
        }
    )
    assert store.update_campaign(empty["id"], {"keywords": "b"})["keywords"] == "b"


def test_running_campaign_cannot_change_search_size(store):
    _, c, _ = prepared(store)
    store.progress(c["id"], "collecting", "…")
    with pytest.raises(AppError, match="приостановите"):
        store.update_campaign(c["id"], {"max_profiles": 50})
    # A plain rename is always safe.
    assert store.update_campaign(c["id"], {"name": "Новое"})["name"] == "Новое"


def test_archive_and_restore(store):
    _, c, _ = prepared(store)
    store.archive_campaign(c["id"])
    state = store.state()
    assert c["id"] in [x["id"] for x in state["archived_campaigns"]]
    assert c["id"] not in [x["id"] for x in state["campaigns"]]
    assert store.restore_campaign(c["id"])["status"] == "ready"


def test_delete_only_without_contacts(store):
    _, c, _ = prepared(store)
    assert store.delete_campaign(c["id"]) == {"deleted": True}
    assert c["id"] not in [x["id"] for x in store.state()["campaigns"]]


def test_contacted_campaign_can_only_be_archived(store, monkeypatch):
    _, c, _ = prepared(store)
    monkeypatch.setattr(store, "contacted", lambda cid: True)
    with pytest.raises(AppError, match="только перенести"):
        store.delete_campaign(c["id"])

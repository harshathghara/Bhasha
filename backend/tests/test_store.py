import json

import pytest

from app.models import Show
from app.store import ShowStore


def make_show():
    return Show(id="s1", title="T", show_prompt="p", gm_prompt="g", rules_text="r")


def test_add_and_get(tmp_path):
    store = ShowStore(snapshot_dir=str(tmp_path))
    show = make_show()
    store.add(show)
    assert store.get("s1") is show


def test_get_missing_raises(tmp_path):
    store = ShowStore(snapshot_dir=str(tmp_path))
    with pytest.raises(KeyError):
        store.get("missing")


def test_snapshot_writes_show_to_dict(tmp_path):
    store = ShowStore(snapshot_dir=str(tmp_path))
    show = make_show()
    store.add(show)

    store.snapshot("s1")

    written = json.loads((tmp_path / "s1.json").read_text())
    assert written == show.to_dict()

import pytest

from app.event_bus import EventBus
from app.models import EventKind, Show, Visibility, GM_ID


def make_show():
    return Show(id="s1", title="T", show_prompt="p", gm_prompt="g", rules_text="r")


@pytest.mark.asyncio
async def test_public_event_reaches_everyone_except_sender():
    show = make_show()
    bus = EventBus(show)
    vikram = bus.subscribe("vikram")
    meera = bus.subscribe("meera")

    bus.publish("vikram", "I trust no one.")

    assert vikram.empty()
    assert meera.get_nowait().text == "I trust no one."


@pytest.mark.asyncio
async def test_private_event_reaches_only_recipient():
    show = make_show()
    bus = EventBus(show)
    bus.subscribe("vikram")
    meera = bus.subscribe("meera")
    karan = bus.subscribe("karan")

    bus.publish("vikram", "Ally with me.", visibility=Visibility.PRIVATE,
                recipients=["meera"])

    assert meera.get_nowait().text == "Ally with me."
    assert karan.empty()


@pytest.mark.asyncio
async def test_gm_sees_private_events_and_confessions():
    show = make_show()
    bus = EventBus(show)
    gm = bus.subscribe(GM_ID)
    bus.subscribe("meera")

    bus.publish("vikram", "Ally with me.", visibility=Visibility.PRIVATE,
                recipients=["meera"])
    bus.publish("vikram", "I do not trust Meera.", kind=EventKind.CONFESSION,
                visibility=Visibility.PRIVATE, recipients=[])

    assert gm.qsize() == 2


@pytest.mark.asyncio
async def test_released_private_event_reaches_everyone():
    show = make_show()
    bus = EventBus(show)
    karan = bus.subscribe("karan")

    event = bus.publish("vikram", "Secret.", visibility=Visibility.PRIVATE,
                        recipients=["meera"])
    assert karan.empty()

    event.released = True
    bus.publish("vikram", "Secret, again.", visibility=Visibility.PRIVATE,
                recipients=["meera"])
    assert karan.empty()


@pytest.mark.asyncio
async def test_publish_assigns_monotonic_seq_and_appends_to_show():
    show = make_show()
    show.current_round = 2
    bus = EventBus(show)

    first = bus.publish("vikram", "one")
    second = bus.publish("meera", "two")

    assert (first.seq, second.seq) == (0, 1)
    assert first.round == 2
    assert [e.text for e in show.events] == ["one", "two"]


@pytest.mark.asyncio
async def test_listeners_receive_every_event_unfiltered():
    show = make_show()
    bus = EventBus(show)
    seen = []
    bus.add_listener(seen.append)

    bus.publish("vikram", "public one")
    bus.publish("vikram", "private one", visibility=Visibility.PRIVATE,
                recipients=["meera"])

    assert [e.text for e in seen] == ["public one", "private one"]


@pytest.mark.asyncio
async def test_visible_events_for_includes_own_events_unlike_the_inbox():
    show = make_show()
    bus = EventBus(show)
    vikram = bus.subscribe("vikram")

    bus.publish("vikram", "I trust no one.")

    assert vikram.empty()   # not woken by own words
    assert [e.text for e in bus.visible_events_for("vikram")] == ["I trust no one."]


@pytest.mark.asyncio
async def test_visible_events_for_excludes_other_peoples_private_traffic():
    show = make_show()
    bus = EventBus(show)

    bus.publish("meera", "Public line.")
    bus.publish("meera", "Secret to Karan.", visibility=Visibility.PRIVATE,
                recipients=["karan"])
    bus.publish("meera", "My private thought.", kind=EventKind.CONFESSION,
                visibility=Visibility.PRIVATE, recipients=[])

    assert [e.text for e in bus.visible_events_for("vikram")] == ["Public line."]
    assert len(bus.visible_events_for("karan")) == 2
    assert len(bus.visible_events_for(GM_ID)) == 3


@pytest.mark.asyncio
async def test_visible_events_for_respects_limit_and_keeps_the_newest():
    show = make_show()
    bus = EventBus(show)
    for index in range(5):
        bus.publish("meera", f"line {index}")

    recent = bus.visible_events_for("vikram", limit=2)

    assert [e.text for e in recent] == ["line 3", "line 4"]


@pytest.mark.asyncio
async def test_all_inboxes_empty_reflects_queue_state():
    show = make_show()
    bus = EventBus(show)
    bus.subscribe("vikram")
    meera = bus.subscribe("meera")

    assert bus.all_inboxes_empty() is True
    bus.publish("vikram", "hello")
    assert bus.all_inboxes_empty() is False
    meera.get_nowait()
    assert bus.all_inboxes_empty() is True

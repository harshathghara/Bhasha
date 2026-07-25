import asyncio

import pytest

from app.event_bus import EventBus
from app.gm_loop import build_gm_prompt, dispatch_gm_calls, run_gm_loop
from app.models import (
    Agent, AgentStatus, Event, EventKind, RoundConfig, Show, Visibility, GM_ID,
)


def make_show():
    agents = [
        Agent(id="vikram", name="Vikram", personality_prompt="p"),
        Agent(id="meera", name="Meera", personality_prompt="p"),
    ]
    return Show(id="s1", title="T", show_prompt="p", gm_prompt="Be fair.",
                rules_text="No unfounded accusations.", contestants=agents,
                current_round=1)


class FakeLLMClient:
    def __init__(self, calls_per_wake):
        self.calls_per_wake = list(calls_per_wake)
        self.wake_count = 0

    def complete_with_tools(self, system_prompt, user_prompt, tools):
        self.wake_count += 1
        if not self.calls_per_wake:
            return []
        return self.calls_per_wake.pop(0)


def test_build_gm_prompt_labels_producer_notes():
    show = make_show()
    event = Event(
        seq=0, round=1, sender_id="producer",
        text="A letter arrives accusing Karan.",
        kind=EventKind.PRODUCER_NOTE,
    )
    _, user_prompt = build_gm_prompt(show, [event])
    assert "[PRODUCER CLUE] A letter arrives accusing Karan." in user_prompt


def test_build_gm_prompt_shows_private_and_confession_content():
    show = make_show()
    batch = [
        Event(seq=0, round=1, sender_id="vikram", text="Meera is lying."),
        Event(seq=1, round=1, sender_id="meera", text="Ally with me.",
              visibility=Visibility.PRIVATE, recipients=["vikram"]),
        Event(seq=2, round=1, sender_id="meera", text="I am scared.",
              kind=EventKind.CONFESSION, visibility=Visibility.PRIVATE),
    ]

    system_prompt, user_prompt = build_gm_prompt(show, batch)

    assert "Be fair." in system_prompt
    assert "No unfounded accusations." in system_prompt
    assert "Meera is lying." in user_prompt
    assert "Ally with me." in user_prompt
    assert "I am scared." in user_prompt


def test_dispatch_warn_marks_agent_and_publishes_public_ruling():
    show = make_show()
    bus = EventBus(show)
    stop_event = asyncio.Event()

    dispatch_gm_calls(show, bus, [
        {"name": "warn", "arguments": {"agent_id": "vikram", "reason": "No evidence."}},
    ], stop_event)

    vikram = show.get_agent("vikram")
    assert vikram.status == AgentStatus.WARNED
    assert vikram.warnings == 1
    assert show.events[-1].kind == EventKind.GM_RULING
    assert show.events[-1].visibility == Visibility.PUBLIC
    assert show.events[-1].text == "No evidence."


def test_dispatch_eject_eliminates_agent():
    show = make_show()
    bus = EventBus(show)
    stop_event = asyncio.Event()

    dispatch_gm_calls(show, bus, [
        {"name": "eject", "arguments": {"agent_id": "vikram", "reason": "Repeat breach."}},
    ], stop_event)

    assert show.get_agent("vikram").status == AgentStatus.ELIMINATED
    assert show.events[-1].kind == EventKind.GM_RULING


def test_dispatch_end_round_sets_stop_event():
    show = make_show()
    bus = EventBus(show)
    stop_event = asyncio.Event()

    dispatch_gm_calls(show, bus, [
        {"name": "end_round", "arguments": {"reason": "The vote is settled."}},
    ], stop_event)

    assert stop_event.is_set()
    assert show.events[-1].kind == EventKind.GM_ANNOUNCEMENT


@pytest.mark.asyncio
async def test_run_gm_loop_thinks_only_every_n_events():
    show = make_show()
    bus = EventBus(show)
    stop_event = asyncio.Event()
    llm_client = FakeLLMClient([])
    config = RoundConfig(gm_review_every=3)

    task = asyncio.create_task(
        run_gm_loop(show, bus, llm_client, config, stop_event)
    )
    await asyncio.sleep(0)
    for index in range(3):
        bus.publish("vikram", f"line {index}")
    await asyncio.sleep(0.05)
    stop_event.set()
    task.cancel()
    await asyncio.gather(task, return_exceptions=True)

    assert llm_client.wake_count == 1

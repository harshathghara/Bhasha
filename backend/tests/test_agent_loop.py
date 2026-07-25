import asyncio

import pytest

from app.agent_loop import build_agent_prompt, dispatch_agent_calls, run_agent_loop
from app.event_bus import EventBus
from app.models import Agent, AgentStatus, EventKind, RoundConfig, Show, Visibility


def make_show():
    agents = [
        Agent(id="vikram", name="Vikram", personality_prompt="Be ruthless."),
        Agent(id="meera", name="Meera", personality_prompt="Keep the peace."),
    ]
    return Show(id="s1", title="T", show_prompt="premise", gm_prompt="g",
                rules_text="rules", contestants=agents, current_round=1)


def fast_config(**overrides):
    defaults = dict(action_budget=1, debounce_seconds=0.0, cooldown_seconds=0.0)
    defaults.update(overrides)
    return RoundConfig(**defaults)


class FakeLLMClient:
    def __init__(self, calls_per_wake):
        self.calls_per_wake = list(calls_per_wake)
        self.prompts = []

    def complete_with_tools(self, system_prompt, user_prompt, tools):
        self.prompts.append((system_prompt, user_prompt))
        if not self.calls_per_wake:
            return []
        return self.calls_per_wake.pop(0)


def test_build_agent_prompt_labels_producer_notes():
    show = make_show()
    bus = EventBus(show)
    bus.publish(
        "producer",
        "Push the cash angle harder.",
        kind=EventKind.PRODUCER_NOTE,
    )
    agent = show.get_agent("vikram")
    _, user_prompt = build_agent_prompt(show, agent, bus, fast_config())
    assert "[Producer note] Push the cash angle harder." in user_prompt


def test_build_agent_prompt_uses_the_visible_log_not_an_inbox_batch():
    show = make_show()
    bus = EventBus(show)
    agent = show.get_agent("vikram")
    bus.publish("meera", "Let us all be calm.")
    bus.publish("vikram", "I said something earlier.")

    system_prompt, user_prompt = build_agent_prompt(show, agent, bus, fast_config())

    assert "Be ruthless." in system_prompt
    assert "rules" in system_prompt
    assert "Let us all be calm." in user_prompt
    assert "I said something earlier." in user_prompt   # remembers its own words


def test_build_agent_prompt_hides_private_traffic_between_others():
    show = make_show()
    bus = EventBus(show)
    agent = show.get_agent("vikram")
    bus.publish("meera", "Public line.")
    bus.publish("meera", "Not for Vikram.", visibility=Visibility.PRIVATE,
                recipients=["karan"])

    _, user_prompt = build_agent_prompt(show, agent, bus, fast_config())

    assert "Public line." in user_prompt
    assert "Not for Vikram." not in user_prompt


def test_build_agent_prompt_caps_history_at_the_context_window():
    show = make_show()
    bus = EventBus(show)
    agent = show.get_agent("vikram")
    for index in range(10):
        bus.publish("meera", f"line {index}")

    _, user_prompt = build_agent_prompt(
        show, agent, bus, fast_config(context_window_events=3)
    )

    assert "line 9" in user_prompt
    assert "line 0" not in user_prompt


def test_build_agent_prompt_includes_secret_connection_when_set():
    show = make_show()
    bus = EventBus(show)
    agent = show.get_agent("vikram")
    agent.connected_to = "meera"
    agent.connection_note = "Meera is Vikram's estranged sister."

    system_prompt, _ = build_agent_prompt(show, agent, bus, fast_config())

    assert "Meera is Vikram's estranged sister." in system_prompt


def test_dispatch_publishes_public_private_and_confession():
    show = make_show()
    bus = EventBus(show)
    agent = show.get_agent("vikram")

    published = dispatch_agent_calls(bus, agent, [
        {"name": "speak_public", "arguments": {"text": "I trust no one."}},
        {"name": "send_private", "arguments": {"to": "meera", "text": "Ally?"}},
        {"name": "confess", "arguments": {"text": "I am bluffing."}},
    ])

    assert published == 3
    kinds = [(e.kind, e.visibility, e.recipients) for e in show.events]
    assert kinds == [
        (EventKind.AGENT_ACTION, Visibility.PUBLIC, []),
        (EventKind.AGENT_ACTION, Visibility.PRIVATE, ["meera"]),
        (EventKind.CONFESSION, Visibility.PRIVATE, []),
    ]


def test_dispatch_stay_silent_publishes_nothing():
    show = make_show()
    bus = EventBus(show)
    agent = show.get_agent("vikram")

    published = dispatch_agent_calls(bus, agent, [
        {"name": "stay_silent", "arguments": {}},
    ])

    assert published == 0
    assert show.events == []


@pytest.mark.asyncio
async def test_run_agent_loop_acts_on_inbox_event_then_exits_on_budget():
    show = make_show()
    bus = EventBus(show)
    agent = show.get_agent("vikram")
    agent.actions_remaining = 1
    llm_client = FakeLLMClient([
        [{"name": "speak_public", "arguments": {"text": "I am listening."}}],
    ])

    task = asyncio.create_task(
        run_agent_loop(show, agent, bus, llm_client, fast_config())
    )
    await asyncio.sleep(0)
    bus.publish("meera", "Anyone awake?")
    await asyncio.wait_for(task, timeout=2)

    assert [e.text for e in show.events if e.sender_id == "vikram"] == ["I am listening."]
    assert agent.actions_remaining == 0
    assert "vikram" not in bus.inboxes


@pytest.mark.asyncio
async def test_run_agent_loop_batches_a_burst_into_one_call():
    show = make_show()
    bus = EventBus(show)
    agent = show.get_agent("vikram")
    agent.actions_remaining = 1
    llm_client = FakeLLMClient([[{"name": "stay_silent", "arguments": {}}]])

    task = asyncio.create_task(
        run_agent_loop(show, agent, bus, llm_client, fast_config())
    )
    await asyncio.sleep(0)
    bus.publish("meera", "First thing.")
    bus.publish("meera", "Second thing.")
    await asyncio.wait_for(task, timeout=2)

    assert len(llm_client.prompts) == 1
    _, user_prompt = llm_client.prompts[0]
    assert "First thing." in user_prompt
    assert "Second thing." in user_prompt


@pytest.mark.asyncio
async def test_agent_that_spent_its_budget_still_sees_later_events():
    """Gap 1 regression: context comes from the log, not the inbox, so an agent
    that stopped acting is not blind to what happened afterwards."""
    show = make_show()
    bus = EventBus(show)
    agent = show.get_agent("vikram")
    agent.actions_remaining = 1
    llm_client = FakeLLMClient([[{"name": "stay_silent", "arguments": {}}]])

    task = asyncio.create_task(
        run_agent_loop(show, agent, bus, llm_client, fast_config())
    )
    await asyncio.sleep(0)
    bus.publish("meera", "Round one chatter.")
    await asyncio.wait_for(task, timeout=2)

    # Budget spent, loop exited, inbox gone. The house keeps talking.
    bus.publish("meera", "Something said after Vikram went quiet.")

    _, user_prompt = build_agent_prompt(show, agent, bus, fast_config())
    assert "Something said after Vikram went quiet." in user_prompt


@pytest.mark.asyncio
async def test_run_agent_loop_tracks_in_flight_during_the_call():
    show = make_show()
    bus = EventBus(show)
    agent = show.get_agent("vikram")
    agent.actions_remaining = 1
    seen_in_flight = []

    class ObservingClient:
        def complete_with_tools(self, system_prompt, user_prompt, tools):
            seen_in_flight.append(bus.in_flight)
            return []

    task = asyncio.create_task(
        run_agent_loop(show, agent, bus, ObservingClient(), fast_config())
    )
    await asyncio.sleep(0)
    bus.publish("meera", "Anyone awake?")
    await asyncio.wait_for(task, timeout=2)

    assert seen_in_flight == [1]
    assert bus.in_flight == 0


@pytest.mark.asyncio
async def test_run_agent_loop_exits_when_eliminated_mid_round():
    show = make_show()
    bus = EventBus(show)
    agent = show.get_agent("vikram")
    agent.actions_remaining = 5
    agent.status = AgentStatus.ELIMINATED
    llm_client = FakeLLMClient([
        [{"name": "speak_public", "arguments": {"text": "I should not speak."}}],
    ])

    task = asyncio.create_task(
        run_agent_loop(show, agent, bus, llm_client, fast_config())
    )
    await asyncio.sleep(0)
    bus.publish("meera", "Anyone awake?")
    await asyncio.wait_for(task, timeout=2)

    assert [e.text for e in show.events if e.sender_id == "vikram"] == []
    assert "vikram" not in bus.inboxes

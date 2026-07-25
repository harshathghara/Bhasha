import pytest

from app.models import (
    Agent, AgentStatus, Event, EventKind, RoundConfig, Show, Visibility, GM_ID,
)


def test_event_defaults():
    event = Event(seq=0, round=1, sender_id="vikram", text="hello")
    assert event.kind == EventKind.AGENT_ACTION
    assert event.visibility == Visibility.PUBLIC
    assert event.recipients == []
    assert event.released is False
    assert event.to_dict()["visibility"] == "public"


def test_agent_defaults():
    agent = Agent(id="vikram", name="Vikram", personality_prompt="Be ruthless.")
    assert agent.status == AgentStatus.ACTIVE
    assert agent.connected_to is None
    assert agent.actions_remaining == 0
    assert agent.to_dict()["status"] == "active"


def test_agent_status_has_no_paused_state():
    assert not hasattr(AgentStatus, "PAUSED")


def test_show_get_agent_found_and_missing():
    agent = Agent(id="vikram", name="Vikram", personality_prompt="p")
    show = Show(id="s1", title="T", show_prompt="p", gm_prompt="g",
                rules_text="r", contestants=[agent])
    assert show.get_agent("vikram") is agent
    with pytest.raises(KeyError):
        show.get_agent("missing")


def test_active_agents_excludes_eliminated():
    agents = [
        Agent(id="a", name="A", personality_prompt="p"),
        Agent(id="b", name="B", personality_prompt="p", status=AgentStatus.WARNED),
        Agent(id="c", name="C", personality_prompt="p", status=AgentStatus.ELIMINATED),
    ]
    show = Show(id="s1", title="T", show_prompt="p", gm_prompt="g",
                rules_text="r", contestants=agents)
    assert [a.id for a in show.active_agents()] == ["a", "b"]


def test_events_for_round_filters_by_round():
    show = Show(id="s1", title="T", show_prompt="p", gm_prompt="g", rules_text="r")
    show.events.append(Event(seq=0, round=1, sender_id="a", text="one"))
    show.events.append(Event(seq=1, round=2, sender_id="a", text="two"))
    assert [e.text for e in show.events_for_round(2)] == ["two"]


def test_round_config_defaults():
    config = RoundConfig()
    assert config.action_budget == 4
    assert config.gm_review_every == 3
    assert config.context_window_events == 60
    assert GM_ID == "game_master"


def test_event_leak_fields_default_and_serialize():
    default_event = Event(seq=1, round=1, sender_id="a", text="hi")
    assert default_event.leaked_from_seq is None
    assert default_event.to_dict()["leaked_from_seq"] is None

    leak_event = Event(
        seq=0, round=1, sender_id="game_master", text="It has been leaked...",
        kind=EventKind.LEAK, leaked_from_seq=3,
    )
    assert leak_event.leaked_from_seq == 3
    assert leak_event.to_dict()["leaked_from_seq"] == 3
    assert leak_event.to_dict()["kind"] == "leak"

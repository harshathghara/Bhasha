import pytest

from app.models import Agent, AgentStatus
from app.presets import (
    DEFAULT_SHOW_PROMPT, DEFAULT_GM_PROMPT, DEFAULT_RULES_TEXT,
    PRESET_AGENT_PERSONALITIES, build_preset_agent,
)

MURDER_IDS = {"creditor", "wife", "lawyer", "brother", "househelp"}


def test_defaults_are_nonempty_strings():
    assert DEFAULT_SHOW_PROMPT and isinstance(DEFAULT_SHOW_PROMPT, str)
    assert DEFAULT_GM_PROMPT and isinstance(DEFAULT_GM_PROMPT, str)
    assert DEFAULT_RULES_TEXT and isinstance(DEFAULT_RULES_TEXT, str)


def test_defaults_describe_the_murder_blame_premise():
    from app.presets import SHOW_TITLE
    assert SHOW_TITLE == "Bhram"
    assert "Bhram" in DEFAULT_SHOW_PROMPT
    assert "Ramesh Malhotra" in DEFAULT_SHOW_PROMPT
    assert "killer" in DEFAULT_SHOW_PROMPT.lower()
    assert "blame" in DEFAULT_GM_PROMPT.lower()
    assert "missing" in DEFAULT_SHOW_PROMPT.lower()
    assert "one of the five" in DEFAULT_RULES_TEXT.lower()
    assert "outsiders" in DEFAULT_GM_PROMPT.lower()


def test_preset_pool_has_five_unique_murder_cast_personalities():
    assert len(PRESET_AGENT_PERSONALITIES) == 5
    ids = {p["id"] for p in PRESET_AGENT_PERSONALITIES}
    assert ids == MURDER_IDS
    for preset in PRESET_AGENT_PERSONALITIES:
        prompt = preset["personality_prompt"].lower()
        assert preset["name"] and preset["personality_prompt"]
        assert "do not know who the killer is" in prompt \
            or "don't know who the killer is" in prompt
        assert "2 to 4 short sentences" in prompt
        assert "mysterious outsiders" in prompt
        assert "betrayal loop" in prompt


def test_househelp_calls_out_leaks_by_name():
    preset = next(p for p in PRESET_AGENT_PERSONALITIES if p["id"] == "househelp")
    prompt = preset["personality_prompt"].lower()
    assert "public leak" in prompt
    assert "name" in prompt


def test_build_preset_agent_returns_active_agent():
    agent = build_preset_agent("creditor")
    assert isinstance(agent, Agent)
    assert agent.id == "creditor"
    assert agent.status == AgentStatus.ACTIVE


def test_build_preset_agent_missing_raises():
    with pytest.raises(KeyError):
        build_preset_agent("strategist")

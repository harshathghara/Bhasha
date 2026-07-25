import pytest

from app.models import Agent, AgentStatus
from app.presets import (
    DEFAULT_SHOW_PROMPT, DEFAULT_GM_PROMPT, DEFAULT_RULES_TEXT,
    PRESET_AGENT_PERSONALITIES, build_preset_agent,
)


def test_defaults_are_nonempty_strings():
    assert DEFAULT_SHOW_PROMPT and isinstance(DEFAULT_SHOW_PROMPT, str)
    assert DEFAULT_GM_PROMPT and isinstance(DEFAULT_GM_PROMPT, str)
    assert DEFAULT_RULES_TEXT and isinstance(DEFAULT_RULES_TEXT, str)


def test_preset_pool_has_eight_unique_personalities():
    assert len(PRESET_AGENT_PERSONALITIES) == 8
    assert len({p["id"] for p in PRESET_AGENT_PERSONALITIES}) == 8
    for preset in PRESET_AGENT_PERSONALITIES:
        assert preset["name"] and preset["personality_prompt"]


def test_build_preset_agent_returns_active_agent():
    agent = build_preset_agent("strategist")
    assert isinstance(agent, Agent)
    assert agent.id == "strategist"
    assert agent.status == AgentStatus.ACTIVE


def test_build_preset_agent_missing_raises():
    with pytest.raises(KeyError):
        build_preset_agent("nonexistent")

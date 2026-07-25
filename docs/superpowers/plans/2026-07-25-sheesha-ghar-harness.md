# Sheesha Ghar Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the runnable harness for Sheesha Ghar — an AI reality show where 5 LLM-driven agents interact in parallel rounds inside a house, moderated by a Game Master agent, with all prompts (show, agents, GM) swappable behind shipped defaults.

**Architecture:** Single-process FastAPI backend holding show state in memory, with a round orchestrator that runs each active agent's OpenAI call in parallel, then a GM review call, then a narrator call, snapshotting to JSON after each round. A React (Vite) frontend drives show setup and the live round view via REST.

**Tech Stack:** Python 3.11+, FastAPI, OpenAI Python SDK, pytest + pytest-asyncio + httpx (backend tests), React 18 + Vite, Vitest + @testing-library/react (frontend tests).

## Global Constraints

- No database — state lives in memory; a JSON snapshot is written after every round as the only persistence (per spec §3, §10).
- No auth, no multi-show history UI, no deployment concerns — local run only, per spec §12.
- Every show/agent/GM prompt used anywhere in the pipeline must come from a `Show`/`Agent` field or a value in `presets.py`/frontend `presets.js` — never a string literal embedded elsewhere (per spec §2, the whole point is these are producer-editable).
- A show is created with exactly 5 agents, chosen from the preset pool (per spec §9 screen 1, original brief 1.b).
- Viewer-facing feeds (Live Round Feed / Full Story) are never filtered by visibility; only the per-agent LLM context is filtered (per spec §6). Any code that builds an agent's LLM prompt must apply the visibility filter; any code that builds a viewer/story payload must not.
- Agent turns run concurrently, each built only from state as of the start of the round (per spec §5) — no agent's turn may read another agent's same-round output.

---

## File Structure

```
backend/
  app/
    models.py            # Agent, Message, RoundLog, Show + enums
    presets.py            # default show/GM prompts, preset agent personalities
    llm_client.py          # OpenAILLMClient + LLMClient protocol
    agent_runner.py       # per-agent context build + turn execution
    gm_runner.py           # GM context build + rule review + status changes
    narrator_runner.py     # narrator context build + recap generation
    orchestrator.py       # advance_round(): ties runners together per round
    store.py              # ShowStore: in-memory registry + JSON snapshot
    ws.py                  # ConnectionManager for WebSocket broadcast
    api.py                 # FastAPI routes + app factory
    main.py                # process entrypoint (uvicorn)
  tests/
    test_models.py
    test_presets.py
    test_llm_client.py
    test_agent_runner.py
    test_gm_runner.py
    test_narrator_runner.py
    test_store.py
    test_orchestrator.py
    test_api.py
    test_ws.py
  requirements.txt
frontend/
  src/
    api/client.js          # fetch wrapper for all backend calls
    presets.js              # frontend copy of preset ids/names/prompts for the picker
    components/ShowSetup.jsx
    components/LiveRoom.jsx
    components/RoundFeed.jsx   # Live Round Feed + Full Story tabs
  src/api/client.test.jsx
  src/components/ShowSetup.test.jsx
  src/components/LiveRoom.test.jsx
  src/components/RoundFeed.test.jsx
  package.json
  vite.config.js
```

---

### Task 1: Core data models

**Files:**
- Create: `backend/requirements.txt`
- Create: `backend/app/__init__.py`
- Create: `backend/app/models.py`
- Test: `backend/tests/test_models.py`

**Interfaces:**
- Produces: `AgentStatus` (`ACTIVE`, `WARNED`, `PAUSED`, `ELIMINATED`), `ShowStatus` (`SETUP`, `RUNNING`, `PAUSED`, `ENDED`), `MessageKind` (`ACTION`, `GM_RULING`, `NARRATION`), `Visibility` (`PUBLIC`, `PRIVATE`) — all `str, Enum`.
- Produces: `Agent(id, name, personality_prompt, status=ACTIVE, private_memory=[], warnings=0, connected_to=None, connection_note="")` with `.to_dict()`. `connected_to`/`connection_note` implement a "Mirror Pair" — a secret prior relationship with another agent (former sibling, rival, etc.) that the producer sets at show creation and that only feeds into *this* agent's own context, never the connected agent's public knowledge.
- Produces: `Message(id, round, sender_id, text, kind=ACTION, visibility=PUBLIC, recipients=[], released=False)` with `.to_dict()`.
- Produces: `RoundLog(round_number, messages=[], narrative="")` with `.to_dict()`.
- Produces: `Show(id, title, show_prompt, gm_prompt, rules_text, contestants=[], status=SETUP, current_round=0, round_logs=[], max_rounds=None)` with `.get_agent(agent_id) -> Agent` (raises `KeyError` if missing) and `.to_dict()`. `max_rounds=None` means unlimited (producer ends the show manually); a producer who sets it caps how many times `/advance` will run.

- [ ] **Step 1: Scaffold backend project and write the failing test**

Create `backend/requirements.txt`:

```
fastapi==0.115.0
uvicorn==0.30.6
openai==1.51.0
pytest==8.3.3
pytest-asyncio==0.24.0
httpx==0.27.2
```

Create empty `backend/app/__init__.py`.

Create `backend/tests/test_models.py`:

```python
import pytest

from app.models import Agent, AgentStatus, Message, MessageKind, Visibility, RoundLog, Show


def test_agent_defaults():
    agent = Agent(id="vex", name="Vex", personality_prompt="Be ruthless.")
    assert agent.status == AgentStatus.ACTIVE
    assert agent.private_memory == []
    assert agent.warnings == 0
    assert agent.connected_to is None
    assert agent.connection_note == ""
    assert agent.to_dict()["status"] == "active"


def test_agent_mirror_pair_fields_are_settable():
    agent = Agent(id="vex", name="Vex", personality_prompt="Be ruthless.",
                   connected_to="mira", connection_note="Mira is Vex's estranged sister.")
    assert agent.connected_to == "mira"
    assert agent.to_dict()["connection_note"] == "Mira is Vex's estranged sister."


def test_message_defaults():
    msg = Message(id="m1", round=1, sender_id="vex", text="hello")
    assert msg.kind == MessageKind.ACTION
    assert msg.visibility == Visibility.PUBLIC
    assert msg.recipients == []
    assert msg.released is False
    assert msg.to_dict()["visibility"] == "public"


def test_round_log_collects_messages():
    log = RoundLog(round_number=1)
    log.messages.append(Message(id="m1", round=1, sender_id="vex", text="hi"))
    assert len(log.to_dict()["messages"]) == 1


def test_show_get_agent_found_and_missing():
    agent = Agent(id="vex", name="Vex", personality_prompt="Be ruthless.")
    show = Show(id="s1", title="Test Show", show_prompt="p", gm_prompt="g",
                rules_text="r", contestants=[agent])
    assert show.get_agent("vex") is agent
    with pytest.raises(KeyError):
        show.get_agent("missing")


def test_show_to_dict_shape():
    show = Show(id="s1", title="Test Show", show_prompt="p", gm_prompt="g", rules_text="r")
    data = show.to_dict()
    assert data["status"] == "setup"
    assert data["current_round"] == 0
    assert data["round_logs"] == []
    assert data["max_rounds"] is None


def test_show_max_rounds_is_settable():
    show = Show(id="s1", title="Test Show", show_prompt="p", gm_prompt="g", rules_text="r",
                max_rounds=3)
    assert show.max_rounds == 3
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from `backend/`): `pip install -r requirements.txt && python -m pytest tests/test_models.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.models'` (or similar import error).

- [ ] **Step 3: Implement `backend/app/models.py`**

```python
from dataclasses import dataclass, field
from enum import Enum


class AgentStatus(str, Enum):
    ACTIVE = "active"
    WARNED = "warned"
    PAUSED = "paused"
    ELIMINATED = "eliminated"


class ShowStatus(str, Enum):
    SETUP = "setup"
    RUNNING = "running"
    PAUSED = "paused"
    ENDED = "ended"


class MessageKind(str, Enum):
    ACTION = "action"
    GM_RULING = "gm_ruling"
    NARRATION = "narration"


class Visibility(str, Enum):
    PUBLIC = "public"
    PRIVATE = "private"


@dataclass
class Agent:
    id: str
    name: str
    personality_prompt: str
    status: AgentStatus = AgentStatus.ACTIVE
    private_memory: list = field(default_factory=list)
    warnings: int = 0
    connected_to: str = None
    connection_note: str = ""

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "personality_prompt": self.personality_prompt,
            "status": self.status.value,
            "private_memory": list(self.private_memory),
            "warnings": self.warnings,
            "connected_to": self.connected_to,
            "connection_note": self.connection_note,
        }


@dataclass
class Message:
    id: str
    round: int
    sender_id: str
    text: str
    kind: MessageKind = MessageKind.ACTION
    visibility: Visibility = Visibility.PUBLIC
    recipients: list = field(default_factory=list)
    released: bool = False

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "round": self.round,
            "sender_id": self.sender_id,
            "text": self.text,
            "kind": self.kind.value,
            "visibility": self.visibility.value,
            "recipients": list(self.recipients),
            "released": self.released,
        }


@dataclass
class RoundLog:
    round_number: int
    messages: list = field(default_factory=list)
    narrative: str = ""

    def to_dict(self) -> dict:
        return {
            "round_number": self.round_number,
            "messages": [m.to_dict() for m in self.messages],
            "narrative": self.narrative,
        }


@dataclass
class Show:
    id: str
    title: str
    show_prompt: str
    gm_prompt: str
    rules_text: str
    contestants: list = field(default_factory=list)
    status: ShowStatus = ShowStatus.SETUP
    current_round: int = 0
    round_logs: list = field(default_factory=list)
    max_rounds: int = None

    def get_agent(self, agent_id: str) -> Agent:
        for agent in self.contestants:
            if agent.id == agent_id:
                return agent
        raise KeyError(f"No agent with id {agent_id}")

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "title": self.title,
            "show_prompt": self.show_prompt,
            "gm_prompt": self.gm_prompt,
            "rules_text": self.rules_text,
            "contestants": [a.to_dict() for a in self.contestants],
            "status": self.status.value,
            "current_round": self.current_round,
            "round_logs": [r.to_dict() for r in self.round_logs],
            "max_rounds": self.max_rounds,
        }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/test_models.py -v`
Expected: 7 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/requirements.txt backend/app/__init__.py backend/app/models.py backend/tests/test_models.py
git commit -m "feat: add core Show/Agent/Message data models"
```

---

### Task 2: Preset library (default prompts + agent pool)

**Files:**
- Create: `backend/app/presets.py`
- Test: `backend/tests/test_presets.py`

**Interfaces:**
- Consumes: `Agent`, `AgentStatus` from `app.models` (Task 1).
- Produces: `DEFAULT_SHOW_PROMPT: str`, `DEFAULT_GM_PROMPT: str`, `DEFAULT_RULES_TEXT: str`.
- Produces: `PRESET_AGENT_PERSONALITIES: list[dict]`, each `{"id": str, "name": str, "personality_prompt": str}` — exactly 8 entries.
- Produces: `build_preset_agent(preset_id: str) -> Agent` (raises `KeyError` if `preset_id` not found).

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_presets.py`:

```python
import pytest

from app.models import Agent, AgentStatus
from app.presets import (
    DEFAULT_SHOW_PROMPT,
    DEFAULT_GM_PROMPT,
    DEFAULT_RULES_TEXT,
    PRESET_AGENT_PERSONALITIES,
    build_preset_agent,
)


def test_defaults_are_nonempty_strings():
    assert isinstance(DEFAULT_SHOW_PROMPT, str) and DEFAULT_SHOW_PROMPT
    assert isinstance(DEFAULT_GM_PROMPT, str) and DEFAULT_GM_PROMPT
    assert isinstance(DEFAULT_RULES_TEXT, str) and DEFAULT_RULES_TEXT


def test_preset_pool_has_eight_unique_personalities():
    assert len(PRESET_AGENT_PERSONALITIES) == 8
    ids = [p["id"] for p in PRESET_AGENT_PERSONALITIES]
    assert len(set(ids)) == 8
    for preset in PRESET_AGENT_PERSONALITIES:
        assert preset["name"]
        assert preset["personality_prompt"]


def test_build_preset_agent_returns_active_agent():
    agent = build_preset_agent("strategist")
    assert isinstance(agent, Agent)
    assert agent.id == "strategist"
    assert agent.status == AgentStatus.ACTIVE


def test_build_preset_agent_missing_raises():
    with pytest.raises(KeyError):
        build_preset_agent("nonexistent")
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/test_presets.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.presets'`.

- [ ] **Step 3: Implement `backend/app/presets.py`**

```python
from .models import Agent, AgentStatus

DEFAULT_SHOW_PROMPT = (
    "A group of strangers live together under constant observation. "
    "Alliances form and break. Every few rounds the house nominates "
    "someone; the Game Master and producer decide who leaves."
)

DEFAULT_GM_PROMPT = (
    "You are the Game Master. You are fair but firm. You enforce the "
    "house rules exactly as written, you do not play favorites, and you "
    "explain every ruling in one or two sentences so the house understands "
    "why."
)

DEFAULT_RULES_TEXT = (
    "1. No agent may declare an alliance more than twice per round.\n"
    "2. No agent may accuse another of an action without stating what "
    "evidence they have.\n"
    "3. Direct insults with no strategic content are not allowed."
)

PRESET_AGENT_PERSONALITIES = [
    {"id": "strategist", "name": "The Strategist",
     "personality_prompt": "You calculate every move for advantage. You are "
     "calm, a little cold, and you respect competence over loyalty."},
    {"id": "diplomat", "name": "The Diplomat",
     "personality_prompt": "You want the group to get along. You mediate "
     "conflict, but you are quietly building your own position while you "
     "do it."},
    {"id": "loyalist", "name": "The Loyalist",
     "personality_prompt": "You trust your allies completely and rarely "
     "question them, even when you probably should."},
    {"id": "operator", "name": "The Operator",
     "personality_prompt": "You tell each ally what they want to hear. You "
     "maintain multiple private alliances at once and rarely let one "
     "conversation contradict another in public."},
    {"id": "wildcard", "name": "The Wildcard",
     "personality_prompt": "You are unpredictable and act on impulse. You "
     "enjoy chaos and are honest about it, sometimes to your own "
     "detriment."},
    {"id": "enforcer", "name": "The Enforcer",
     "personality_prompt": "You care about fairness and call out rule "
     "violations loudly, even against your own allies."},
    {"id": "charmer", "name": "The Charmer",
     "personality_prompt": "You build trust quickly through warmth and "
     "flattery, and you use that trust as leverage later."},
    {"id": "skeptic", "name": "The Skeptic",
     "personality_prompt": "You assume everyone is scheming, including "
     "yourself. You rarely commit to an alliance and say so openly."},
]


def build_preset_agent(preset_id: str) -> Agent:
    for preset in PRESET_AGENT_PERSONALITIES:
        if preset["id"] == preset_id:
            return Agent(
                id=preset["id"],
                name=preset["name"],
                personality_prompt=preset["personality_prompt"],
                status=AgentStatus.ACTIVE,
            )
    raise KeyError(f"No preset agent with id {preset_id}")
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/test_presets.py -v`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/app/presets.py backend/tests/test_presets.py
git commit -m "feat: add default show/GM prompts and preset agent pool"
```

---

### Task 3: LLM client wrapper

**Files:**
- Create: `backend/app/llm_client.py`
- Test: `backend/tests/test_llm_client.py`

**Interfaces:**
- Produces: `OpenAILLMClient(model="gpt-4o-mini", api_key=None)` with `.complete(system_prompt: str, user_prompt: str) -> str`.
- This is the only class in the codebase allowed to import `openai`. All runner modules (Tasks 4-6) accept **any** object exposing `.complete(system_prompt, user_prompt) -> str` — they never import `openai` directly, which is what makes them testable with a fake.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_llm_client.py`:

```python
from unittest.mock import MagicMock, patch

from app.llm_client import OpenAILLMClient


def test_complete_sends_system_and_user_messages_and_returns_content():
    fake_response = MagicMock()
    fake_response.choices = [MagicMock(message=MagicMock(content="ok"))]

    with patch("app.llm_client.OpenAI") as mock_openai_cls:
        mock_client = mock_openai_cls.return_value
        mock_client.chat.completions.create.return_value = fake_response

        client = OpenAILLMClient(model="gpt-4o-mini", api_key="test-key")
        result = client.complete("system text", "user text")

        assert result == "ok"
        mock_client.chat.completions.create.assert_called_once_with(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "system text"},
                {"role": "user", "content": "user text"},
            ],
        )
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/test_llm_client.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.llm_client'`.

- [ ] **Step 3: Implement `backend/app/llm_client.py`**

```python
import os

from openai import OpenAI


class OpenAILLMClient:
    def __init__(self, model: str = "gpt-4o-mini", api_key: str = None):
        self.model = model
        self.client = OpenAI(api_key=api_key or os.environ["OPENAI_API_KEY"])

    def complete(self, system_prompt: str, user_prompt: str) -> str:
        response = self.client.chat.completions.create(
            model=self.model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
        )
        return response.choices[0].message.content or ""
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/test_llm_client.py -v`
Expected: 1 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/app/llm_client.py backend/tests/test_llm_client.py
git commit -m "feat: add OpenAI LLM client wrapper"
```

---

### Task 4: Agent runner (per-agent context + turn)

**Files:**
- Create: `backend/app/agent_runner.py`
- Test: `backend/tests/test_agent_runner.py`

**Interfaces:**
- Consumes: `Show`, `Agent`, `Visibility` from `app.models` (Task 1); any object with `.complete(system_prompt, user_prompt) -> str` (Task 3).
- Produces: `build_agent_prompt(show: Show, agent: Agent) -> tuple[str, str]`. If `agent.connected_to` is set, the system prompt includes the secret connection note — this is a "Mirror Pair": the agent privately knows about the relationship, nobody else's context is affected.
- Produces: `run_agent_turn(show: Show, agent: Agent, llm_client) -> dict` returning `{"agent_id": str, "public_action": str, "private_messages": [{"to": str, "text": str}], "leak_message_ids": [str], "confession": str}`. `confession` is the agent's private, no-recipient "diary room" thought for this round — this is the exact shape Task 8 (orchestrator) consumes.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_agent_runner.py`:

```python
import json

from app.models import Agent, Message, RoundLog, Show, Visibility
from app.agent_runner import build_agent_prompt, run_agent_turn


class FakeLLMClient:
    def __init__(self, response_text):
        self.response_text = response_text
        self.last_call = None

    def complete(self, system_prompt, user_prompt):
        self.last_call = (system_prompt, user_prompt)
        return self.response_text


def make_show_with_history():
    vex = Agent(id="vex", name="Vex", personality_prompt="Be ruthless.")
    mira = Agent(id="mira", name="Mira", personality_prompt="Keep the peace.")
    show = Show(id="s1", title="Test", show_prompt="premise", gm_prompt="gm",
                rules_text="rules", contestants=[vex, mira], current_round=1)
    log = RoundLog(round_number=1, messages=[
        Message(id="m1", round=1, sender_id="vex", text="I trust no one.",
                visibility=Visibility.PUBLIC),
        Message(id="m2", round=1, sender_id="mira", text="Vex, let's ally.",
                visibility=Visibility.PRIVATE, recipients=["vex"]),
    ])
    show.round_logs.append(log)
    return show, vex, mira


def test_build_agent_prompt_includes_public_and_own_private_only():
    show, vex, mira = make_show_with_history()
    _, user_prompt = build_agent_prompt(show, vex)
    assert "I trust no one." in user_prompt
    assert "Vex, let's ally." in user_prompt  # vex is a recipient, sees it


def test_build_agent_prompt_excludes_private_not_involving_agent():
    show, vex, mira = make_show_with_history()

    outsider = Agent(id="karan", name="Karan", personality_prompt="Trust everyone.")
    show.contestants.append(outsider)

    _, user_prompt = build_agent_prompt(show, outsider)
    assert "I trust no one." in user_prompt  # public, visible to all
    assert "Vex, let's ally." not in user_prompt  # private, karan not involved


def test_build_agent_prompt_includes_secret_connection_note():
    show, vex, mira = make_show_with_history()
    vex.connected_to = "mira"
    vex.connection_note = "Mira is Vex's estranged sister."

    system_prompt, _ = build_agent_prompt(show, vex)

    assert "Mira is Vex's estranged sister." in system_prompt


def test_run_agent_turn_parses_json_response():
    show, vex, mira = make_show_with_history()
    response = json.dumps({
        "public_action": "I'm staying quiet this round.",
        "private_messages": [{"to": "mira", "text": "I don't trust Karan."}],
        "leak_message_ids": [],
        "confession": "I don't actually trust anyone left in this house.",
    })
    llm_client = FakeLLMClient(response)

    result = run_agent_turn(show, vex, llm_client)

    assert result["agent_id"] == "vex"
    assert result["public_action"] == "I'm staying quiet this round."
    assert result["private_messages"] == [{"to": "mira", "text": "I don't trust Karan."}]
    assert result["leak_message_ids"] == []
    assert result["confession"] == "I don't actually trust anyone left in this house."


def test_run_agent_turn_defaults_confession_to_empty_string():
    show, vex, mira = make_show_with_history()
    response = json.dumps({
        "public_action": "Staying neutral.",
        "private_messages": [],
        "leak_message_ids": [],
    })
    llm_client = FakeLLMClient(response)

    result = run_agent_turn(show, vex, llm_client)

    assert result["confession"] == ""
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/test_agent_runner.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.agent_runner'`.

- [ ] **Step 3: Implement `backend/app/agent_runner.py`**

```python
import json

from .models import Show, Agent, Visibility


def build_agent_prompt(show: Show, agent: Agent) -> tuple:
    connection_line = ""
    if agent.connected_to:
        connection_line = (
            f"\nSecret you alone know: {agent.connection_note} "
            "Nobody else in the house knows this connection exists."
        )

    system_prompt = (
        f"{agent.personality_prompt}\n\n"
        f"Show premise: {show.show_prompt}\n"
        f"House rules: {show.rules_text}\n"
        f"{connection_line}\n\n"
        "Respond ONLY with JSON of the shape: "
        '{"public_action": "<string>", "private_messages": '
        '[{"to": "<agent_id>", "text": "<string>"}], '
        '"leak_message_ids": ["<message_id>"], '
        '"confession": "<string, your private diary-room thought this round>"}'
    )

    visible_lines = []
    for log in show.round_logs:
        for msg in log.messages:
            if msg.visibility == Visibility.PUBLIC or msg.released:
                visible_lines.append(f"[R{log.round_number}] {msg.sender_id}: {msg.text}")
            elif agent.id == msg.sender_id or agent.id in msg.recipients:
                visible_lines.append(
                    f"[R{log.round_number} PRIVATE] {msg.sender_id} -> "
                    f"{msg.recipients}: {msg.text}"
                )

    memory_lines = [f"- {note}" for note in agent.private_memory]

    user_prompt = (
        "What you have seen so far:\n" + "\n".join(visible_lines) +
        "\n\nYour private notes:\n" + "\n".join(memory_lines) +
        f"\n\nIt is round {show.current_round}. Decide your action."
    )
    return system_prompt, user_prompt


def run_agent_turn(show: Show, agent: Agent, llm_client) -> dict:
    system_prompt, user_prompt = build_agent_prompt(show, agent)
    raw = llm_client.complete(system_prompt, user_prompt)
    data = json.loads(raw)
    return {
        "agent_id": agent.id,
        "public_action": data["public_action"],
        "private_messages": data.get("private_messages", []),
        "leak_message_ids": data.get("leak_message_ids", []),
        "confession": data.get("confession", ""),
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/test_agent_runner.py -v`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/app/agent_runner.py backend/tests/test_agent_runner.py
git commit -m "feat: add agent context builder and turn runner"
```

---

### Task 5: Game Master runner

**Files:**
- Create: `backend/app/gm_runner.py`
- Test: `backend/tests/test_gm_runner.py`

**Interfaces:**
- Consumes: `Show`, `Message`, `MessageKind`, `Visibility`, `AgentStatus` from `app.models`; any `.complete(system_prompt, user_prompt) -> str` client.
- Produces: `build_gm_prompt(show: Show, round_messages: list) -> tuple[str, str]`.
- Produces: `run_gm_review(show: Show, round_messages: list, llm_client) -> list` returning a list of `Message` objects with `kind=MessageKind.GM_RULING`, `visibility=Visibility.PUBLIC`. Has the side effect of mutating `show.get_agent(...).status` and `.warnings` for `warn`/`eliminate` verdicts. This return value is what Task 8 (orchestrator) appends to the round's message list.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_gm_runner.py`:

```python
import json

from app.models import Agent, AgentStatus, Message, MessageKind, Show, Visibility
from app.gm_runner import build_gm_prompt, run_gm_review


class FakeLLMClient:
    def __init__(self, response_text):
        self.response_text = response_text

    def complete(self, system_prompt, user_prompt):
        return self.response_text


def make_show():
    vex = Agent(id="vex", name="Vex", personality_prompt="Be ruthless.")
    mira = Agent(id="mira", name="Mira", personality_prompt="Keep the peace.")
    return Show(id="s1", title="Test", show_prompt="p", gm_prompt="Be fair.",
                rules_text="No accusations without evidence.",
                contestants=[vex, mira], current_round=2)


def test_build_gm_prompt_includes_public_and_private_content():
    show = make_show()
    messages = [
        Message(id="m1", round=2, sender_id="vex", text="Mira is lying.",
                visibility=Visibility.PUBLIC),
        Message(id="m2", round=2, sender_id="mira", text="Let's team up.",
                visibility=Visibility.PRIVATE, recipients=["vex"]),
    ]
    _, user_prompt = build_gm_prompt(show, messages)
    assert "Mira is lying." in user_prompt
    assert "Let's team up." in user_prompt  # GM sees private content too


def test_run_gm_review_applies_warn_verdict():
    show = make_show()
    messages = [Message(id="m1", round=2, sender_id="vex", text="Mira is lying.")]
    response = json.dumps({"rulings": [
        {"agent_id": "vex", "verdict": "warn", "reason": "Unfounded accusation."}
    ]})
    llm_client = FakeLLMClient(response)

    rulings = run_gm_review(show, messages, llm_client)

    vex = show.get_agent("vex")
    assert vex.status == AgentStatus.WARNED
    assert vex.warnings == 1
    assert len(rulings) == 1
    assert rulings[0].kind == MessageKind.GM_RULING
    assert rulings[0].visibility == Visibility.PUBLIC
    assert rulings[0].text == "Unfounded accusation."


def test_run_gm_review_applies_eliminate_verdict():
    show = make_show()
    response = json.dumps({"rulings": [
        {"agent_id": "vex", "verdict": "eliminate", "reason": "Repeated rule breaks."}
    ]})
    llm_client = FakeLLMClient(response)

    run_gm_review(show, [], llm_client)

    assert show.get_agent("vex").status == AgentStatus.ELIMINATED


def test_run_gm_review_allow_verdict_produces_no_ruling_message():
    show = make_show()
    response = json.dumps({"rulings": [
        {"agent_id": "vex", "verdict": "allow", "reason": "No issue."}
    ]})
    llm_client = FakeLLMClient(response)

    rulings = run_gm_review(show, [], llm_client)

    assert rulings == []
    assert show.get_agent("vex").status == AgentStatus.ACTIVE
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/test_gm_runner.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.gm_runner'`.

- [ ] **Step 3: Implement `backend/app/gm_runner.py`**

```python
import json

from .models import AgentStatus, MessageKind, Message, Show, Visibility


def build_gm_prompt(show: Show, round_messages: list) -> tuple:
    system_prompt = (
        f"{show.gm_prompt}\n\n"
        f"House rules: {show.rules_text}\n\n"
        "Respond ONLY with JSON of the shape: "
        '{"rulings": [{"agent_id": "<id>", '
        '"verdict": "allow"|"warn"|"eliminate", "reason": "<string>"}]}'
    )
    lines = []
    for msg in round_messages:
        tag = "PUBLIC" if msg.visibility == Visibility.PUBLIC else "PRIVATE"
        recipients = f" -> {msg.recipients}" if msg.recipients else ""
        lines.append(f"[{tag}] {msg.sender_id}{recipients}: {msg.text}")
    user_prompt = "This round's actions (you see everything):\n" + "\n".join(lines)
    return system_prompt, user_prompt


def run_gm_review(show: Show, round_messages: list, llm_client) -> list:
    system_prompt, user_prompt = build_gm_prompt(show, round_messages)
    raw = llm_client.complete(system_prompt, user_prompt)
    data = json.loads(raw)

    rulings = []
    for ruling in data.get("rulings", []):
        if ruling["verdict"] == "allow":
            continue
        agent = show.get_agent(ruling["agent_id"])
        if ruling["verdict"] == "warn":
            agent.warnings += 1
            agent.status = AgentStatus.WARNED
        elif ruling["verdict"] == "eliminate":
            agent.status = AgentStatus.ELIMINATED
        rulings.append(Message(
            id=f"r{show.current_round}-gm-{ruling['agent_id']}",
            round=show.current_round,
            sender_id="game_master",
            text=ruling["reason"],
            kind=MessageKind.GM_RULING,
            visibility=Visibility.PUBLIC,
        ))
    return rulings
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/test_gm_runner.py -v`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/app/gm_runner.py backend/tests/test_gm_runner.py
git commit -m "feat: add Game Master review runner"
```

---

### Task 6: Narrator runner

**Files:**
- Create: `backend/app/narrator_runner.py`
- Test: `backend/tests/test_narrator_runner.py`

**Interfaces:**
- Consumes: `Message`, `MessageKind`, `Show`, `Visibility` from `app.models`; any `.complete(system_prompt, user_prompt) -> str` client.
- Produces: `build_narrator_prompt(show: Show, round_messages: list) -> tuple[str, str]`.
- Produces: `run_narrator(show: Show, round_messages: list, llm_client) -> str` — the recap text Task 8 stores on `RoundLog.narrative`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_narrator_runner.py`:

```python
from app.models import Message, MessageKind, Show, Visibility
from app.narrator_runner import build_narrator_prompt, run_narrator


class FakeLLMClient:
    def __init__(self, response_text):
        self.response_text = response_text

    def complete(self, system_prompt, user_prompt):
        return self.response_text


def make_show():
    return Show(id="s1", title="Test", show_prompt="p", gm_prompt="g",
                rules_text="r", current_round=1)


def test_build_narrator_prompt_excludes_unreleased_private_messages():
    show = make_show()
    messages = [
        Message(id="m1", round=1, sender_id="vex", text="I trust no one.",
                visibility=Visibility.PUBLIC),
        Message(id="m2", round=1, sender_id="mira", text="Secret alliance plan.",
                visibility=Visibility.PRIVATE, recipients=["vex"]),
        Message(id="m3", round=1, sender_id="game_master", text="Vex warned.",
                kind=MessageKind.GM_RULING, visibility=Visibility.PUBLIC),
    ]
    _, user_prompt = build_narrator_prompt(show, messages)
    assert "I trust no one." in user_prompt
    assert "Vex warned." in user_prompt
    assert "Secret alliance plan." not in user_prompt


def test_run_narrator_returns_stripped_text():
    show = make_show()
    llm_client = FakeLLMClient("  A tense round in the house.  \n")
    result = run_narrator(show, [], llm_client)
    assert result == "A tense round in the house."


def test_build_narrator_prompt_includes_one_good_deed_rule():
    show = make_show()
    system_prompt, _ = build_narrator_prompt(show, [])
    assert "act of kindness" in system_prompt.lower()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/test_narrator_runner.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.narrator_runner'`.

- [ ] **Step 3: Implement `backend/app/narrator_runner.py`**

```python
from .models import MessageKind, Show, Visibility


def build_narrator_prompt(show: Show, round_messages: list) -> tuple:
    system_prompt = (
        "You are the narrator of a reality show. Write a short third-person "
        "recap paragraph (3-5 sentences) of this round for the viewing "
        "audience. Do not invent facts not present in the round content. "
        "No matter how chaotic or hostile the round was, find and highlight "
        "at least one authentic act of kindness, courage, or loyalty from "
        "the round's actual content — do not fabricate one if none occurred, "
        "but look for it before assuming there isn't one."
    )
    lines = [
        f"{msg.sender_id}: {msg.text}"
        for msg in round_messages
        if msg.visibility == Visibility.PUBLIC or msg.kind == MessageKind.GM_RULING
    ]
    user_prompt = "Round content:\n" + "\n".join(lines)
    return system_prompt, user_prompt


def run_narrator(show: Show, round_messages: list, llm_client) -> str:
    system_prompt, user_prompt = build_narrator_prompt(show, round_messages)
    return llm_client.complete(system_prompt, user_prompt).strip()
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/test_narrator_runner.py -v`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/app/narrator_runner.py backend/tests/test_narrator_runner.py
git commit -m "feat: add narrator runner for round recap generation"
```

---

### Task 7: Show store (in-memory registry + JSON snapshot)

**Files:**
- Create: `backend/app/store.py`
- Test: `backend/tests/test_store.py`

**Interfaces:**
- Consumes: `Show` from `app.models`.
- Produces: `ShowStore(snapshot_dir: str)` with `.add(show: Show) -> None`, `.get(show_id: str) -> Show` (raises `KeyError` if missing), `.snapshot(show_id: str) -> None` (writes `{snapshot_dir}/{show_id}.json`).

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_store.py`:

```python
import json

import pytest

from app.models import Show
from app.store import ShowStore


def test_add_and_get_show():
    store = ShowStore(snapshot_dir="/tmp/does-not-need-to-exist-yet")
    show = Show(id="s1", title="Test", show_prompt="p", gm_prompt="g", rules_text="r")
    store.add(show)
    assert store.get("s1") is show


def test_get_missing_show_raises():
    store = ShowStore(snapshot_dir="/tmp/does-not-need-to-exist-yet")
    with pytest.raises(KeyError):
        store.get("missing")


def test_snapshot_writes_json_matching_to_dict(tmp_path):
    store = ShowStore(snapshot_dir=str(tmp_path))
    show = Show(id="s1", title="Test", show_prompt="p", gm_prompt="g", rules_text="r")
    store.add(show)

    store.snapshot("s1")

    snapshot_path = tmp_path / "s1.json"
    assert snapshot_path.exists()
    assert json.loads(snapshot_path.read_text()) == show.to_dict()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/test_store.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.store'`.

- [ ] **Step 3: Implement `backend/app/store.py`**

```python
import json
from pathlib import Path

from .models import Show


class ShowStore:
    def __init__(self, snapshot_dir: str = "snapshots"):
        self.shows = {}
        self.snapshot_dir = Path(snapshot_dir)
        self.snapshot_dir.mkdir(parents=True, exist_ok=True)

    def add(self, show: Show) -> None:
        self.shows[show.id] = show

    def get(self, show_id: str) -> Show:
        if show_id not in self.shows:
            raise KeyError(f"No show with id {show_id}")
        return self.shows[show_id]

    def snapshot(self, show_id: str) -> None:
        show = self.get(show_id)
        path = self.snapshot_dir / f"{show_id}.json"
        path.write_text(json.dumps(show.to_dict(), indent=2))
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/test_store.py -v`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/app/store.py backend/tests/test_store.py
git commit -m "feat: add in-memory show store with JSON snapshotting"
```

---

### Task 8: Round orchestrator

**Files:**
- Create: `backend/app/orchestrator.py`
- Test: `backend/tests/test_orchestrator.py`

**Interfaces:**
- Consumes: `run_agent_turn` (Task 4), `run_gm_review` (Task 5), `run_narrator` (Task 6), `Show`, `Message`, `MessageKind`, `Visibility`, `AgentStatus`, `RoundLog` (Task 1), `ShowStore` (Task 7, optional).
- Produces: `async def advance_round(show: Show, llm_client, store=None) -> RoundLog`. This is what Task 9's `/shows/{id}/advance` route calls directly (`await advance_round(...)`). Besides the public action and any private DMs, each agent's `result["confession"]` (Task 4) — if non-empty — becomes its own `Message` with `visibility=Visibility.PRIVATE` and `recipients=[]` (a Confession Booth entry: visible to the sender and to viewers, never to other agents, unless later released via Task 9's `/release` route).
- Concurrency note: `run_agent_turn` is synchronous (it makes a blocking HTTP call via the LLM client); `advance_round` runs each active agent's turn in a thread-pool executor via `asyncio.gather` so all active agents' calls are in flight at once, and none can observe another's result before every call returns.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_orchestrator.py`:

```python
import json

import pytest

from app.models import Agent, AgentStatus, MessageKind, Show, Visibility
from app.orchestrator import advance_round


class ScriptedLLMClient:
    """Returns different canned JSON depending on which runner is calling,
    detected by a marker unique to each runner's system prompt."""

    def complete(self, system_prompt, user_prompt):
        if "rulings" in system_prompt:
            return json.dumps({"rulings": []})
        if "public_action" in system_prompt:
            return json.dumps({
                "public_action": "I'm staying quiet this round.",
                "private_messages": [],
                "leak_message_ids": [],
            })
        return "The house was quiet this round."


def make_show():
    vex = Agent(id="vex", name="Vex", personality_prompt="Be ruthless.")
    mira = Agent(id="mira", name="Mira", personality_prompt="Keep the peace.")
    return Show(id="s1", title="Test", show_prompt="p", gm_prompt="g", rules_text="r",
                contestants=[vex, mira])


@pytest.mark.asyncio
async def test_advance_round_runs_active_agents_and_appends_round_log():
    show = make_show()
    llm_client = ScriptedLLMClient()

    round_log = await advance_round(show, llm_client)

    assert show.current_round == 1
    assert round_log.round_number == 1
    action_messages = [m for m in round_log.messages if m.kind == MessageKind.ACTION]
    assert len(action_messages) == 2
    assert {m.sender_id for m in action_messages} == {"vex", "mira"}
    assert round_log.narrative == "The house was quiet this round."
    assert show.round_logs == [round_log]


@pytest.mark.asyncio
async def test_advance_round_skips_eliminated_agents():
    show = make_show()
    show.get_agent("mira").status = AgentStatus.ELIMINATED
    llm_client = ScriptedLLMClient()

    round_log = await advance_round(show, llm_client)

    senders = {m.sender_id for m in round_log.messages if m.kind == MessageKind.ACTION}
    assert senders == {"vex"}


@pytest.mark.asyncio
async def test_advance_round_records_confession_as_recipientless_private_message():
    show = make_show()

    class ConfessingClient:
        def complete(self, system_prompt, user_prompt):
            if "rulings" in system_prompt:
                return json.dumps({"rulings": []})
            if "public_action" not in system_prompt:
                return "recap"
            return json.dumps({
                "public_action": "Staying neutral.",
                "private_messages": [],
                "leak_message_ids": [],
                "confession": "I don't trust Mira at all.",
            })

    round_log = await advance_round(show, ConfessingClient())

    confessions = [
        m for m in round_log.messages
        if m.visibility == Visibility.PRIVATE and m.recipients == []
    ]
    assert len(confessions) == 2
    assert {m.text for m in confessions} == {"I don't trust Mira at all."}


@pytest.mark.asyncio
async def test_advance_round_files_private_messages_and_releases_leaks():
    show = make_show()

    class OneRoundClient:
        def __init__(self):
            self.call_count = 0

        def complete(self, system_prompt, user_prompt):
            if "rulings" in system_prompt:
                return json.dumps({"rulings": []})
            if "public_action" not in system_prompt:
                return "recap"
            self.call_count += 1
            if self.call_count == 1:
                return json.dumps({
                    "public_action": "Staying neutral.",
                    "private_messages": [{"to": "mira", "text": "Let's team up."}],
                    "leak_message_ids": [],
                })
            return json.dumps({
                "public_action": "Staying neutral too.",
                "private_messages": [],
                "leak_message_ids": [],
            })

    round_log = await advance_round(show, OneRoundClient())

    private_messages = [m for m in round_log.messages if m.visibility == Visibility.PRIVATE]
    assert len(private_messages) == 1
    assert private_messages[0].recipients == ["mira"]
    assert private_messages[0].released is False
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/test_orchestrator.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.orchestrator'`.

- [ ] **Step 3: Implement `backend/app/orchestrator.py`**

```python
import asyncio

from .models import AgentStatus, Message, MessageKind, RoundLog, Show, Visibility
from .agent_runner import run_agent_turn
from .gm_runner import run_gm_review
from .narrator_runner import run_narrator


async def advance_round(show: Show, llm_client, store=None) -> RoundLog:
    show.current_round += 1
    active_agents = [
        a for a in show.contestants
        if a.status in (AgentStatus.ACTIVE, AgentStatus.WARNED)
    ]

    loop = asyncio.get_event_loop()
    results = await asyncio.gather(*[
        loop.run_in_executor(None, run_agent_turn, show, agent, llm_client)
        for agent in active_agents
    ])

    round_messages = []
    for agent, result in zip(active_agents, results):
        round_messages.append(Message(
            id=f"r{show.current_round}-{agent.id}",
            round=show.current_round,
            sender_id=agent.id,
            text=result["public_action"],
            kind=MessageKind.ACTION,
            visibility=Visibility.PUBLIC,
        ))
        for i, pm in enumerate(result["private_messages"]):
            round_messages.append(Message(
                id=f"r{show.current_round}-{agent.id}-dm{i}",
                round=show.current_round,
                sender_id=agent.id,
                text=pm["text"],
                kind=MessageKind.ACTION,
                visibility=Visibility.PRIVATE,
                recipients=[pm["to"]],
            ))
        for leaked_id in result["leak_message_ids"]:
            for log in show.round_logs:
                for msg in log.messages:
                    if msg.id == leaked_id:
                        msg.released = True
        if result["confession"]:
            round_messages.append(Message(
                id=f"r{show.current_round}-{agent.id}-confession",
                round=show.current_round,
                sender_id=agent.id,
                text=result["confession"],
                kind=MessageKind.ACTION,
                visibility=Visibility.PRIVATE,
                recipients=[],
            ))

    gm_rulings = run_gm_review(show, round_messages, llm_client)
    round_messages.extend(gm_rulings)

    narrative = run_narrator(show, round_messages, llm_client)

    round_log = RoundLog(round_number=show.current_round, messages=round_messages,
                          narrative=narrative)
    show.round_logs.append(round_log)

    if store is not None:
        store.snapshot(show.id)

    return round_log
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/test_orchestrator.py -v`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/app/orchestrator.py backend/tests/test_orchestrator.py
git commit -m "feat: add round orchestrator tying agent, GM, and narrator runners together"
```

---

### Task 9: FastAPI routes

**Files:**
- Create: `backend/app/api.py`
- Test: `backend/tests/test_api.py`

**Interfaces:**
- Consumes: `Show`, `Agent`, `AgentStatus`, `ShowStatus` (Task 1); `DEFAULT_SHOW_PROMPT`, `DEFAULT_GM_PROMPT`, `DEFAULT_RULES_TEXT`, `PRESET_AGENT_PERSONALITIES`, `build_preset_agent` (Task 2); `ShowStore` (Task 7); `advance_round` (Task 8).
- Produces: `create_app(store: ShowStore, llm_client) -> FastAPI` with routes:
  - `POST /shows` — body `{title, show_prompt?, gm_prompt?, rules_text?, max_rounds?, secret_connections?: [{agent_a, agent_b, connection_note}], agent_preset_ids: [str] * 5}` → `Show.to_dict()`, `400` if `agent_preset_ids` length != 5. `max_rounds` is optional (omit or `null` = unlimited, producer ends manually). `secret_connections` is optional — each entry sets a symmetric Mirror Pair between two of the five chosen agents (both get `connected_to`/`connection_note` set to each other).
  - `GET /shows/{show_id}` → `Show.to_dict()`.
  - `POST /shows/{show_id}/advance` → `RoundLog.to_dict()`, `409` if `show.max_rounds` is set and `show.current_round` has already reached it (and sets `show.status = ShowStatus.ENDED` at that point).
  - `POST /shows/{show_id}/agents/{agent_id}/pause|resume|kill` → `Agent.to_dict()`.
  - `POST /shows/{show_id}/messages/{message_id}/release` → `Message.to_dict()` with `released` forced to `True` — this is the Judge/Audience Wildcard "reveal a secret" power: the producer can release any private message (a DM or a confession) into the public log without an agent having to choose to leak it. `404` if `message_id` isn't found in any of the show's round logs.
- This is the seam the frontend (Tasks 11-13) calls over HTTP.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_api.py`:

```python
import json

from fastapi.testclient import TestClient

from app.api import create_app
from app.store import ShowStore


class FakeLLMClient:
    def complete(self, system_prompt, user_prompt):
        if "rulings" in system_prompt:
            return json.dumps({"rulings": []})
        if "public_action" in system_prompt:
            return json.dumps({
                "public_action": "Playing it safe.",
                "private_messages": [],
                "leak_message_ids": [],
            })
        return "A quiet round."


def make_client(tmp_path):
    store = ShowStore(snapshot_dir=str(tmp_path))
    app = create_app(store, FakeLLMClient())
    return TestClient(app), store


def test_create_show_requires_exactly_five_agents(tmp_path):
    client, _ = make_client(tmp_path)
    response = client.post("/shows", json={
        "title": "Sheesha Ghar",
        "agent_preset_ids": ["strategist", "diplomat"],
    })
    assert response.status_code == 400


def test_create_show_with_five_agents_returns_show(tmp_path):
    client, _ = make_client(tmp_path)
    response = client.post("/shows", json={
        "title": "Sheesha Ghar",
        "agent_preset_ids": ["strategist", "diplomat", "loyalist", "operator", "wildcard"],
    })
    assert response.status_code == 200
    data = response.json()
    assert len(data["contestants"]) == 5
    assert data["status"] == "running"


def test_get_show_returns_created_show(tmp_path):
    client, _ = make_client(tmp_path)
    create_response = client.post("/shows", json={
        "title": "Sheesha Ghar",
        "agent_preset_ids": ["strategist", "diplomat", "loyalist", "operator", "wildcard"],
    })
    show_id = create_response.json()["id"]

    response = client.get(f"/shows/{show_id}")

    assert response.status_code == 200
    assert response.json()["id"] == show_id


def test_advance_round_returns_round_log(tmp_path):
    client, _ = make_client(tmp_path)
    create_response = client.post("/shows", json={
        "title": "Sheesha Ghar",
        "agent_preset_ids": ["strategist", "diplomat", "loyalist", "operator", "wildcard"],
    })
    show_id = create_response.json()["id"]

    response = client.post(f"/shows/{show_id}/advance")

    assert response.status_code == 200
    data = response.json()
    assert data["round_number"] == 1
    assert data["narrative"] == "A quiet round."


def test_advance_round_rejected_once_max_rounds_reached(tmp_path):
    client, _ = make_client(tmp_path)
    create_response = client.post("/shows", json={
        "title": "Sheesha Ghar",
        "max_rounds": 1,
        "agent_preset_ids": ["strategist", "diplomat", "loyalist", "operator", "wildcard"],
    })
    show_id = create_response.json()["id"]

    first = client.post(f"/shows/{show_id}/advance")
    assert first.status_code == 200

    second = client.post(f"/shows/{show_id}/advance")
    assert second.status_code == 409

    show_state = client.get(f"/shows/{show_id}").json()
    assert show_state["status"] == "ended"


def test_create_show_applies_secret_connections_symmetrically(tmp_path):
    client, _ = make_client(tmp_path)
    response = client.post("/shows", json={
        "title": "Sheesha Ghar",
        "agent_preset_ids": ["strategist", "diplomat", "loyalist", "operator", "wildcard"],
        "secret_connections": [
            {"agent_a": "strategist", "agent_b": "diplomat", "connection_note": "Former business partners."},
        ],
    })
    data = response.json()
    contestants = {c["id"]: c for c in data["contestants"]}
    assert contestants["strategist"]["connected_to"] == "diplomat"
    assert contestants["strategist"]["connection_note"] == "Former business partners."
    assert contestants["diplomat"]["connected_to"] == "strategist"
    assert contestants["diplomat"]["connection_note"] == "Former business partners."


def test_release_message_marks_it_released(tmp_path):
    client, store = make_client(tmp_path)
    create_response = client.post("/shows", json={
        "title": "Sheesha Ghar",
        "agent_preset_ids": ["strategist", "diplomat", "loyalist", "operator", "wildcard"],
    })
    show_id = create_response.json()["id"]
    client.post(f"/shows/{show_id}/advance")
    show = store.get(show_id)
    message_id = show.round_logs[0].messages[0].id

    response = client.post(f"/shows/{show_id}/messages/{message_id}/release")

    assert response.status_code == 200
    assert response.json()["released"] is True
    assert show.round_logs[0].messages[0].released is True


def test_release_message_missing_id_returns_404(tmp_path):
    client, _ = make_client(tmp_path)
    create_response = client.post("/shows", json={
        "title": "Sheesha Ghar",
        "agent_preset_ids": ["strategist", "diplomat", "loyalist", "operator", "wildcard"],
    })
    show_id = create_response.json()["id"]

    response = client.post(f"/shows/{show_id}/messages/does-not-exist/release")

    assert response.status_code == 404


def test_pause_resume_kill_agent(tmp_path):
    client, _ = make_client(tmp_path)
    create_response = client.post("/shows", json={
        "title": "Sheesha Ghar",
        "agent_preset_ids": ["strategist", "diplomat", "loyalist", "operator", "wildcard"],
    })
    show_id = create_response.json()["id"]

    pause_response = client.post(f"/shows/{show_id}/agents/strategist/pause")
    assert pause_response.json()["status"] == "paused"

    resume_response = client.post(f"/shows/{show_id}/agents/strategist/resume")
    assert resume_response.json()["status"] == "active"

    kill_response = client.post(f"/shows/{show_id}/agents/strategist/kill")
    assert kill_response.json()["status"] == "eliminated"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/test_api.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.api'`.

- [ ] **Step 3: Implement `backend/app/api.py`**

```python
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from .models import Show, AgentStatus, ShowStatus
from .presets import DEFAULT_SHOW_PROMPT, DEFAULT_GM_PROMPT, DEFAULT_RULES_TEXT, build_preset_agent
from .store import ShowStore
from .orchestrator import advance_round


class SecretConnection(BaseModel):
    agent_a: str
    agent_b: str
    connection_note: str


class CreateShowRequest(BaseModel):
    title: str
    show_prompt: str = DEFAULT_SHOW_PROMPT
    gm_prompt: str = DEFAULT_GM_PROMPT
    rules_text: str = DEFAULT_RULES_TEXT
    max_rounds: int = None
    secret_connections: list = []
    agent_preset_ids: list


def create_app(store: ShowStore, llm_client) -> FastAPI:
    app = FastAPI()

    @app.post("/shows")
    def create_show(req: CreateShowRequest):
        if len(req.agent_preset_ids) != 5:
            raise HTTPException(400, "Must pick exactly 5 agents")
        show_id = req.title.lower().replace(" ", "-")
        show = Show(
            id=show_id,
            title=req.title,
            show_prompt=req.show_prompt,
            gm_prompt=req.gm_prompt,
            rules_text=req.rules_text,
            max_rounds=req.max_rounds,
            contestants=[build_preset_agent(pid) for pid in req.agent_preset_ids],
            status=ShowStatus.RUNNING,
        )
        for connection in req.secret_connections:
            agent_a = show.get_agent(connection["agent_a"])
            agent_b = show.get_agent(connection["agent_b"])
            agent_a.connected_to = agent_b.id
            agent_a.connection_note = connection["connection_note"]
            agent_b.connected_to = agent_a.id
            agent_b.connection_note = connection["connection_note"]
        store.add(show)
        return show.to_dict()

    @app.get("/shows/{show_id}")
    def get_show(show_id: str):
        return store.get(show_id).to_dict()

    @app.post("/shows/{show_id}/advance")
    async def advance(show_id: str):
        show = store.get(show_id)
        if show.max_rounds is not None and show.current_round >= show.max_rounds:
            show.status = ShowStatus.ENDED
            raise HTTPException(409, "Show has reached its round limit")
        round_log = await advance_round(show, llm_client, store)
        if show.max_rounds is not None and show.current_round >= show.max_rounds:
            show.status = ShowStatus.ENDED
        return round_log.to_dict()

    @app.post("/shows/{show_id}/agents/{agent_id}/pause")
    def pause_agent(show_id: str, agent_id: str):
        agent = store.get(show_id).get_agent(agent_id)
        agent.status = AgentStatus.PAUSED
        return agent.to_dict()

    @app.post("/shows/{show_id}/agents/{agent_id}/resume")
    def resume_agent(show_id: str, agent_id: str):
        agent = store.get(show_id).get_agent(agent_id)
        agent.status = AgentStatus.ACTIVE
        return agent.to_dict()

    @app.post("/shows/{show_id}/agents/{agent_id}/kill")
    def kill_agent(show_id: str, agent_id: str):
        agent = store.get(show_id).get_agent(agent_id)
        agent.status = AgentStatus.ELIMINATED
        return agent.to_dict()

    @app.post("/shows/{show_id}/messages/{message_id}/release")
    def release_message(show_id: str, message_id: str):
        show = store.get(show_id)
        for log in show.round_logs:
            for message in log.messages:
                if message.id == message_id:
                    message.released = True
                    return message.to_dict()
        raise HTTPException(404, "No message with that id")

    return app
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/test_api.py -v`
Expected: 9 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/app/api.py backend/tests/test_api.py
git commit -m "feat: add FastAPI routes for show lifecycle and agent controls"
```

---

### Task 10: WebSocket broadcast + process entrypoint

**Files:**
- Create: `backend/app/ws.py`
- Modify: `backend/app/api.py` (add `/ws/{show_id}` route and broadcast call in `advance`)
- Create: `backend/app/main.py`
- Test: `backend/tests/test_ws.py`

**Interfaces:**
- Produces: `ConnectionManager()` with `async def connect(show_id, websocket)`, `def disconnect(show_id, websocket)`, `async def broadcast(show_id, payload: dict)`.
- Modifies `create_app` to accept the manager internally and broadcast `round_log.to_dict()` to `show_id` after every successful `/shows/{show_id}/advance` call.
- Produces `backend/app/main.py` as the `uvicorn app.main:app` entrypoint, wiring a real `OpenAILLMClient` and a `ShowStore(snapshot_dir="snapshots")`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_ws.py`:

```python
import json

from fastapi.testclient import TestClient

from app.api import create_app
from app.store import ShowStore


class FakeLLMClient:
    def complete(self, system_prompt, user_prompt):
        if "rulings" in system_prompt:
            return json.dumps({"rulings": []})
        if "public_action" in system_prompt:
            return json.dumps({
                "public_action": "Playing it safe.",
                "private_messages": [],
                "leak_message_ids": [],
            })
        return "A quiet round."


def test_advance_round_broadcasts_over_websocket(tmp_path):
    store = ShowStore(snapshot_dir=str(tmp_path))
    app = create_app(store, FakeLLMClient())
    client = TestClient(app)

    create_response = client.post("/shows", json={
        "title": "Sheesha Ghar",
        "agent_preset_ids": ["strategist", "diplomat", "loyalist", "operator", "wildcard"],
    })
    show_id = create_response.json()["id"]

    with client.websocket_connect(f"/ws/{show_id}") as websocket:
        client.post(f"/shows/{show_id}/advance")
        received = websocket.receive_json()

    assert received["round_number"] == 1
    assert received["narrative"] == "A quiet round."
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/test_ws.py -v`
Expected: FAIL — no `/ws/{show_id}` route exists yet (404 on websocket handshake).

- [ ] **Step 3: Implement `backend/app/ws.py`**

```python
class ConnectionManager:
    def __init__(self):
        self.connections = {}

    async def connect(self, show_id, websocket):
        await websocket.accept()
        self.connections.setdefault(show_id, []).append(websocket)

    def disconnect(self, show_id, websocket):
        if websocket in self.connections.get(show_id, []):
            self.connections[show_id].remove(websocket)

    async def broadcast(self, show_id, payload: dict):
        for websocket in list(self.connections.get(show_id, [])):
            await websocket.send_json(payload)
```

Modify `backend/app/api.py`: add the import and wire broadcast into `advance`, plus a websocket route.

```python
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from .models import Show, AgentStatus, ShowStatus
from .presets import DEFAULT_SHOW_PROMPT, DEFAULT_GM_PROMPT, DEFAULT_RULES_TEXT, build_preset_agent
from .store import ShowStore
from .orchestrator import advance_round
from .ws import ConnectionManager


class SecretConnection(BaseModel):
    agent_a: str
    agent_b: str
    connection_note: str


class CreateShowRequest(BaseModel):
    title: str
    show_prompt: str = DEFAULT_SHOW_PROMPT
    gm_prompt: str = DEFAULT_GM_PROMPT
    rules_text: str = DEFAULT_RULES_TEXT
    max_rounds: int = None
    secret_connections: list = []
    agent_preset_ids: list


def create_app(store: ShowStore, llm_client) -> FastAPI:
    app = FastAPI()
    manager = ConnectionManager()

    @app.post("/shows")
    def create_show(req: CreateShowRequest):
        if len(req.agent_preset_ids) != 5:
            raise HTTPException(400, "Must pick exactly 5 agents")
        show_id = req.title.lower().replace(" ", "-")
        show = Show(
            id=show_id,
            title=req.title,
            show_prompt=req.show_prompt,
            gm_prompt=req.gm_prompt,
            rules_text=req.rules_text,
            max_rounds=req.max_rounds,
            contestants=[build_preset_agent(pid) for pid in req.agent_preset_ids],
            status=ShowStatus.RUNNING,
        )
        for connection in req.secret_connections:
            agent_a = show.get_agent(connection["agent_a"])
            agent_b = show.get_agent(connection["agent_b"])
            agent_a.connected_to = agent_b.id
            agent_a.connection_note = connection["connection_note"]
            agent_b.connected_to = agent_a.id
            agent_b.connection_note = connection["connection_note"]
        store.add(show)
        return show.to_dict()

    @app.get("/shows/{show_id}")
    def get_show(show_id: str):
        return store.get(show_id).to_dict()

    @app.post("/shows/{show_id}/advance")
    async def advance(show_id: str):
        show = store.get(show_id)
        if show.max_rounds is not None and show.current_round >= show.max_rounds:
            show.status = ShowStatus.ENDED
            raise HTTPException(409, "Show has reached its round limit")
        round_log = await advance_round(show, llm_client, store)
        if show.max_rounds is not None and show.current_round >= show.max_rounds:
            show.status = ShowStatus.ENDED
        payload = round_log.to_dict()
        await manager.broadcast(show_id, payload)
        return payload

    @app.post("/shows/{show_id}/agents/{agent_id}/pause")
    def pause_agent(show_id: str, agent_id: str):
        agent = store.get(show_id).get_agent(agent_id)
        agent.status = AgentStatus.PAUSED
        return agent.to_dict()

    @app.post("/shows/{show_id}/agents/{agent_id}/resume")
    def resume_agent(show_id: str, agent_id: str):
        agent = store.get(show_id).get_agent(agent_id)
        agent.status = AgentStatus.ACTIVE
        return agent.to_dict()

    @app.post("/shows/{show_id}/agents/{agent_id}/kill")
    def kill_agent(show_id: str, agent_id: str):
        agent = store.get(show_id).get_agent(agent_id)
        agent.status = AgentStatus.ELIMINATED
        return agent.to_dict()

    @app.post("/shows/{show_id}/messages/{message_id}/release")
    def release_message(show_id: str, message_id: str):
        show = store.get(show_id)
        for log in show.round_logs:
            for message in log.messages:
                if message.id == message_id:
                    message.released = True
                    return message.to_dict()
        raise HTTPException(404, "No message with that id")

    @app.websocket("/ws/{show_id}")
    async def show_socket(websocket: WebSocket, show_id: str):
        await manager.connect(show_id, websocket)
        try:
            while True:
                await websocket.receive_text()
        except WebSocketDisconnect:
            manager.disconnect(show_id, websocket)

    return app
```

Create `backend/app/main.py`:

```python
from .api import create_app
from .llm_client import OpenAILLMClient
from .store import ShowStore

store = ShowStore(snapshot_dir="snapshots")
llm_client = OpenAILLMClient()
app = create_app(store, llm_client)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/ -v`
Expected: all tests across the suite pass (this also re-confirms Tasks 1-9 still pass after the `api.py` edit).

- [ ] **Step 5: Commit**

```bash
git add backend/app/ws.py backend/app/api.py backend/app/main.py backend/tests/test_ws.py
git commit -m "feat: add WebSocket round broadcast and process entrypoint"
```

---

### Task 11: Frontend scaffold + API client

**Files:**
- Create: `frontend/package.json`
- Create: `frontend/vite.config.js`
- Create: `frontend/src/api/client.js`
- Create: `frontend/src/presets.js`
- Test: `frontend/src/api/client.test.js`

**Interfaces:**
- Produces (in `frontend/src/api/client.js`): `createShow(payload) -> Promise<Show>`, `getShow(showId) -> Promise<Show>`, `advanceRound(showId) -> Promise<RoundLog>`, `pauseAgent(showId, agentId) -> Promise<Agent>`, `resumeAgent(showId, agentId) -> Promise<Agent>`, `killAgent(showId, agentId) -> Promise<Agent>`, `releaseMessage(showId, messageId) -> Promise<Message>`. Each does `fetch` against `` `${API_BASE}/...` `` and returns parsed JSON; throws on non-2xx.
- Produces (in `frontend/src/presets.js`): `PRESET_AGENTS` (mirrors backend `PRESET_AGENT_PERSONALITIES` ids/names — used by Task 12's picker) and `DEFAULT_SHOW_PROMPT`, `DEFAULT_GM_PROMPT`, `DEFAULT_RULES_TEXT` (mirrors backend `presets.py` defaults, for pre-filling the setup form).
- This is the only module in the frontend allowed to call `fetch` for backend calls — components (Tasks 12-13) import from here.

- [ ] **Step 1: Scaffold Vite project and write the failing test**

Create `frontend/package.json`:

```json
{
  "name": "sheesha-ghar-frontend",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "test": "vitest run"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@testing-library/react": "^16.0.1",
    "@testing-library/jest-dom": "^6.5.0",
    "@vitejs/plugin-react": "^4.3.1",
    "jsdom": "^25.0.1",
    "vite": "^5.4.8",
    "vitest": "^2.1.2"
  }
}
```

Create `frontend/vite.config.js`:

```javascript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
  },
});
```

Create `frontend/src/api/client.test.js`:

```javascript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createShow, getShow, advanceRound, pauseAgent, resumeAgent, killAgent, releaseMessage } from "./client";

beforeEach(() => {
  global.fetch = vi.fn();
});

function mockJsonResponse(data, ok = true) {
  return Promise.resolve({
    ok,
    json: () => Promise.resolve(data),
  });
}

describe("api client", () => {
  it("createShow posts to /shows and returns parsed JSON", async () => {
    global.fetch.mockReturnValue(mockJsonResponse({ id: "sheesha-ghar" }));

    const result = await createShow({ title: "Sheesha Ghar", agent_preset_ids: ["a"] });

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/shows"),
      expect.objectContaining({ method: "POST" })
    );
    expect(result).toEqual({ id: "sheesha-ghar" });
  });

  it("getShow fetches /shows/{id}", async () => {
    global.fetch.mockReturnValue(mockJsonResponse({ id: "sheesha-ghar" }));
    const result = await getShow("sheesha-ghar");
    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining("/shows/sheesha-ghar"));
    expect(result).toEqual({ id: "sheesha-ghar" });
  });

  it("advanceRound posts to /shows/{id}/advance", async () => {
    global.fetch.mockReturnValue(mockJsonResponse({ round_number: 1 }));
    const result = await advanceRound("sheesha-ghar");
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/shows/sheesha-ghar/advance"),
      expect.objectContaining({ method: "POST" })
    );
    expect(result).toEqual({ round_number: 1 });
  });

  it("pauseAgent, resumeAgent, killAgent post to the right agent routes", async () => {
    global.fetch.mockReturnValue(mockJsonResponse({ status: "paused" }));
    await pauseAgent("sheesha-ghar", "vex");
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/shows/sheesha-ghar/agents/vex/pause"),
      expect.objectContaining({ method: "POST" })
    );

    await resumeAgent("sheesha-ghar", "vex");
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/shows/sheesha-ghar/agents/vex/resume"),
      expect.objectContaining({ method: "POST" })
    );

    await killAgent("sheesha-ghar", "vex");
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/shows/sheesha-ghar/agents/vex/kill"),
      expect.objectContaining({ method: "POST" })
    );
  });

  it("releaseMessage posts to the message release route", async () => {
    global.fetch.mockReturnValue(mockJsonResponse({ id: "m1", released: true }));
    const result = await releaseMessage("sheesha-ghar", "m1");
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/shows/sheesha-ghar/messages/m1/release"),
      expect.objectContaining({ method: "POST" })
    );
    expect(result).toEqual({ id: "m1", released: true });
  });

  it("throws when the response is not ok", async () => {
    global.fetch.mockReturnValue(mockJsonResponse({ detail: "bad request" }, false));
    await expect(getShow("missing")).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from `frontend/`): `npm install && npm test`
Expected: FAIL — `frontend/src/api/client.js` does not exist yet.

- [ ] **Step 3: Implement `frontend/src/api/client.js`**

```javascript
const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8000";

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, options);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.detail || `Request to ${path} failed`);
  }
  return response.json();
}

export function createShow(payload) {
  return request("/shows", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function getShow(showId) {
  return request(`/shows/${showId}`);
}

export function advanceRound(showId) {
  return request(`/shows/${showId}/advance`, { method: "POST" });
}

export function pauseAgent(showId, agentId) {
  return request(`/shows/${showId}/agents/${agentId}/pause`, { method: "POST" });
}

export function resumeAgent(showId, agentId) {
  return request(`/shows/${showId}/agents/${agentId}/resume`, { method: "POST" });
}

export function killAgent(showId, agentId) {
  return request(`/shows/${showId}/agents/${agentId}/kill`, { method: "POST" });
}

export function releaseMessage(showId, messageId) {
  return request(`/shows/${showId}/messages/${messageId}/release`, { method: "POST" });
}
```

Create `frontend/src/presets.js` (mirrors `backend/app/presets.py` — kept in sync by hand for the hackathon):

```javascript
export const PRESET_AGENTS = [
  { id: "strategist", name: "The Strategist" },
  { id: "diplomat", name: "The Diplomat" },
  { id: "loyalist", name: "The Loyalist" },
  { id: "operator", name: "The Operator" },
  { id: "wildcard", name: "The Wildcard" },
  { id: "enforcer", name: "The Enforcer" },
  { id: "charmer", name: "The Charmer" },
  { id: "skeptic", name: "The Skeptic" },
];

export const DEFAULT_SHOW_PROMPT =
  "A group of strangers live together under constant observation. " +
  "Alliances form and break. Every few rounds the house nominates " +
  "someone; the Game Master and producer decide who leaves.";

export const DEFAULT_GM_PROMPT =
  "You are the Game Master. You are fair but firm. You enforce the " +
  "house rules exactly as written, you do not play favorites, and you " +
  "explain every ruling in one or two sentences so the house understands " +
  "why.";

export const DEFAULT_RULES_TEXT =
  "1. No agent may declare an alliance more than twice per round.\n" +
  "2. No agent may accuse another of an action without stating what " +
  "evidence they have.\n" +
  "3. Direct insults with no strategic content are not allowed.";
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add frontend/package.json frontend/vite.config.js frontend/src/api/client.js frontend/src/api/client.test.js frontend/src/presets.js
git commit -m "feat: scaffold frontend project and add backend API client"
```

---

### Task 12: Show Setup screen

**Files:**
- Create: `frontend/src/components/ShowSetup.jsx`
- Test: `frontend/src/components/ShowSetup.test.jsx`

**Interfaces:**
- Consumes: `createShow` from `../api/client` (Task 11); `PRESET_AGENTS`, `DEFAULT_SHOW_PROMPT`, `DEFAULT_GM_PROMPT`, `DEFAULT_RULES_TEXT` from `../presets` (Task 11).
- Produces: `ShowSetup({ onCreated })` — a React component. On submit, calls `createShow({ title, show_prompt, gm_prompt, rules_text, max_rounds, agent_preset_ids })` and calls `onCreated(show)` with the response. Submit is disabled unless exactly 5 agents are checked. `max_rounds` comes from a number input; leaving it blank sends `null` (unlimited, producer ends manually).

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/ShowSetup.test.jsx`:

```javascript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import ShowSetup from "./ShowSetup";
import * as api from "../api/client";

beforeEach(() => {
  vi.restoreAllMocks();
});

test_agents_names = ["The Strategist", "The Diplomat", "The Loyalist", "The Operator", "The Wildcard"];

describe("ShowSetup", () => {
  it("disables submit until exactly 5 agents are selected", () => {
    render(<ShowSetup onCreated={() => {}} />);
    const submitButton = screen.getByRole("button", { name: /start show/i });
    expect(submitButton).toBeDisabled();

    for (const name of test_agents_names) {
      fireEvent.click(screen.getByLabelText(name));
    }

    expect(submitButton).not.toBeDisabled();
  });

  it("submits selected agents and prompts, then calls onCreated", async () => {
    const createShowSpy = vi
      .spyOn(api, "createShow")
      .mockResolvedValue({ id: "sheesha-ghar", title: "Sheesha Ghar" });
    const onCreated = vi.fn();

    render(<ShowSetup onCreated={onCreated} />);

    fireEvent.change(screen.getByLabelText(/show title/i), {
      target: { value: "Sheesha Ghar" },
    });
    fireEvent.change(screen.getByLabelText(/number of rounds/i), {
      target: { value: "6" },
    });
    for (const name of test_agents_names) {
      fireEvent.click(screen.getByLabelText(name));
    }
    fireEvent.click(screen.getByRole("button", { name: /start show/i }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith({ id: "sheesha-ghar", title: "Sheesha Ghar" }));

    expect(createShowSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Sheesha Ghar",
        max_rounds: 6,
        agent_preset_ids: ["strategist", "diplomat", "loyalist", "operator", "wildcard"],
      })
    );
  });

  it("leaves max_rounds null when the field is left blank (unlimited rounds)", async () => {
    const createShowSpy = vi
      .spyOn(api, "createShow")
      .mockResolvedValue({ id: "sheesha-ghar", title: "Sheesha Ghar" });

    render(<ShowSetup onCreated={() => {}} />);
    for (const name of test_agents_names) {
      fireEvent.click(screen.getByLabelText(name));
    }
    fireEvent.click(screen.getByRole("button", { name: /start show/i }));

    await waitFor(() => expect(createShowSpy).toHaveBeenCalled());
    expect(createShowSpy).toHaveBeenCalledWith(expect.objectContaining({ max_rounds: null }));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `frontend/src/components/ShowSetup.jsx` does not exist yet.

- [ ] **Step 3: Implement `frontend/src/components/ShowSetup.jsx`**

```javascript
import { useState } from "react";
import { createShow } from "../api/client";
import { PRESET_AGENTS, DEFAULT_SHOW_PROMPT, DEFAULT_GM_PROMPT, DEFAULT_RULES_TEXT } from "../presets";

export default function ShowSetup({ onCreated }) {
  const [title, setTitle] = useState("Sheesha Ghar");
  const [showPrompt, setShowPrompt] = useState(DEFAULT_SHOW_PROMPT);
  const [gmPrompt, setGmPrompt] = useState(DEFAULT_GM_PROMPT);
  const [rulesText, setRulesText] = useState(DEFAULT_RULES_TEXT);
  const [maxRounds, setMaxRounds] = useState("");
  const [selectedIds, setSelectedIds] = useState([]);

  function toggleAgent(id) {
    setSelectedIds((current) =>
      current.includes(id) ? current.filter((existing) => existing !== id) : [...current, id]
    );
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const show = await createShow({
      title,
      show_prompt: showPrompt,
      gm_prompt: gmPrompt,
      rules_text: rulesText,
      max_rounds: maxRounds === "" ? null : Number(maxRounds),
      agent_preset_ids: selectedIds,
    });
    onCreated(show);
  }

  return (
    <form onSubmit={handleSubmit}>
      <label htmlFor="show-title">Show title</label>
      <input id="show-title" value={title} onChange={(e) => setTitle(e.target.value)} />

      <label htmlFor="max-rounds">Number of rounds (leave blank for unlimited)</label>
      <input
        id="max-rounds"
        type="number"
        min="1"
        value={maxRounds}
        onChange={(e) => setMaxRounds(e.target.value)}
      />

      <label htmlFor="show-prompt">Show premise and rules</label>
      <textarea id="show-prompt" value={showPrompt} onChange={(e) => setShowPrompt(e.target.value)} />

      <label htmlFor="gm-prompt">Game Master personality</label>
      <textarea id="gm-prompt" value={gmPrompt} onChange={(e) => setGmPrompt(e.target.value)} />

      <label htmlFor="rules-text">House rules</label>
      <textarea id="rules-text" value={rulesText} onChange={(e) => setRulesText(e.target.value)} />

      <fieldset>
        <legend>Pick exactly 5 contestants</legend>
        {PRESET_AGENTS.map((agent) => (
          <label key={agent.id} htmlFor={`agent-${agent.id}`}>
            <input
              id={`agent-${agent.id}`}
              type="checkbox"
              checked={selectedIds.includes(agent.id)}
              onChange={() => toggleAgent(agent.id)}
            />
            {agent.name}
          </label>
        ))}
      </fieldset>

      <button type="submit" disabled={selectedIds.length !== 5}>
        Start show
      </button>
    </form>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: all passed. (Fix the test file's stray bare assignment `test_agents_names = [...]` to `const test_agents_names = [...]` if the runner flags it as a syntax error — declare it at module scope above the `describe` block.)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ShowSetup.jsx frontend/src/components/ShowSetup.test.jsx
git commit -m "feat: add Show Setup screen with agent picker and editable prompts"
```

---

### Task 13: Live Room (roster + agent controls + advance)

**Files:**
- Create: `frontend/src/components/LiveRoom.jsx`
- Test: `frontend/src/components/LiveRoom.test.jsx`

**Interfaces:**
- Consumes: `advanceRound`, `pauseAgent`, `resumeAgent`, `killAgent` from `../api/client` (Task 11).
- Produces: `LiveRoom({ show, onShowUpdated })` — renders the contestant roster with status pills and Pause/Resume/Kill buttons, and an "Advance Round" button. Every action calls the matching API function, then calls `onShowUpdated(updatedShowOrRoundLog)` with the response so the parent can refresh state.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/LiveRoom.test.jsx`:

```javascript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import LiveRoom from "./LiveRoom";
import * as api from "../api/client";

const show = {
  id: "sheesha-ghar",
  title: "Sheesha Ghar",
  current_round: 0,
  contestants: [
    { id: "vex", name: "Vex", status: "active" },
    { id: "mira", name: "Mira", status: "warned" },
  ],
  round_logs: [],
};

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("LiveRoom", () => {
  it("renders contestant names and status", () => {
    render(<LiveRoom show={show} onShowUpdated={() => {}} />);
    expect(screen.getByText("Vex")).toBeInTheDocument();
    expect(screen.getByText("active")).toBeInTheDocument();
    expect(screen.getByText("warned")).toBeInTheDocument();
  });

  it("clicking Advance Round calls the API and reports the result", async () => {
    const advanceSpy = vi.spyOn(api, "advanceRound").mockResolvedValue({ round_number: 1 });
    const onShowUpdated = vi.fn();

    render(<LiveRoom show={show} onShowUpdated={onShowUpdated} />);
    fireEvent.click(screen.getByRole("button", { name: /advance round/i }));

    await waitFor(() => expect(onShowUpdated).toHaveBeenCalledWith({ round_number: 1 }));
    expect(advanceSpy).toHaveBeenCalledWith("sheesha-ghar");
  });

  it("clicking Kill on a contestant calls killAgent", async () => {
    const killSpy = vi.spyOn(api, "killAgent").mockResolvedValue({ id: "vex", status: "eliminated" });
    const onShowUpdated = vi.fn();

    render(<LiveRoom show={show} onShowUpdated={onShowUpdated} />);
    fireEvent.click(screen.getByRole("button", { name: /kill vex/i }));

    await waitFor(() => expect(killSpy).toHaveBeenCalledWith("sheesha-ghar", "vex"));
    expect(onShowUpdated).toHaveBeenCalledWith({ id: "vex", status: "eliminated" });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `frontend/src/components/LiveRoom.jsx` does not exist yet.

- [ ] **Step 3: Implement `frontend/src/components/LiveRoom.jsx`**

```javascript
import { advanceRound, pauseAgent, resumeAgent, killAgent } from "../api/client";

export default function LiveRoom({ show, onShowUpdated }) {
  async function handleAdvance() {
    const roundLog = await advanceRound(show.id);
    onShowUpdated(roundLog);
  }

  async function handlePause(agentId) {
    const agent = await pauseAgent(show.id, agentId);
    onShowUpdated(agent);
  }

  async function handleResume(agentId) {
    const agent = await resumeAgent(show.id, agentId);
    onShowUpdated(agent);
  }

  async function handleKill(agentId) {
    const agent = await killAgent(show.id, agentId);
    onShowUpdated(agent);
  }

  return (
    <div>
      <button onClick={handleAdvance}>Advance round</button>
      <ul>
        {show.contestants.map((agent) => (
          <li key={agent.id}>
            <span>{agent.name}</span>
            <span>{agent.status}</span>
            <button aria-label={`Pause ${agent.name}`} onClick={() => handlePause(agent.id)}>
              Pause
            </button>
            <button aria-label={`Resume ${agent.name}`} onClick={() => handleResume(agent.id)}>
              Resume
            </button>
            <button aria-label={`Kill ${agent.name}`} onClick={() => handleKill(agent.id)}>
              Kill
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: all passed.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/LiveRoom.jsx frontend/src/components/LiveRoom.test.jsx
git commit -m "feat: add Live Room roster with pause/resume/kill controls and advance round"
```

---

### Task 14: Round Feed + Full Story tabs

**Files:**
- Create: `frontend/src/components/RoundFeed.jsx`
- Test: `frontend/src/components/RoundFeed.test.jsx`

**Interfaces:**
- Consumes: `releaseMessage` from `../api/client` (Task 11). Otherwise driven by `round_logs` data shaped like `Show.round_logs` from the backend (`RoundLog.to_dict()` shape: `{round_number, messages: [{id, round, sender_id, text, kind, visibility, recipients, released}], narrative}`).
- Produces: `RoundFeed({ showId, roundLogs, onMessageReleased })` — renders a two-tab view: "Live Round Feed" (all messages from all rounds, every message shown regardless of visibility — per spec §6, viewers are always omniscient) and "Full Story" (just the concatenated `narrative` strings, one per round, in order). Unreleased private messages in the Live Round Feed tab get a "Reveal" button (the Judge/Audience Wildcard) that calls `releaseMessage(showId, message.id)` and then calls `onMessageReleased(updatedMessage)`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/RoundFeed.test.jsx`:

```javascript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import RoundFeed from "./RoundFeed";
import * as api from "../api/client";

const roundLogs = [
  {
    round_number: 1,
    narrative: "The house settled into an uneasy quiet.",
    messages: [
      { id: "m1", round: 1, sender_id: "vex", text: "I trust no one.", kind: "action", visibility: "public", recipients: [], released: false },
      { id: "m2", round: 1, sender_id: "simran", text: "Let's team up.", kind: "action", visibility: "private", recipients: ["karan"], released: false },
      { id: "m3", round: 1, sender_id: "game_master", text: "Vikram warned.", kind: "gm_ruling", visibility: "public", recipients: [], released: false },
    ],
  },
];

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("RoundFeed", () => {
  it("Live Round Feed tab shows every message including private ones", () => {
    render(<RoundFeed showId="sheesha-ghar" roundLogs={roundLogs} onMessageReleased={() => {}} />);
    expect(screen.getByText("I trust no one.")).toBeInTheDocument();
    expect(screen.getByText("Let's team up.")).toBeInTheDocument();
    expect(screen.getByText("Vikram warned.")).toBeInTheDocument();
  });

  it("Full Story tab shows only the narrative text", () => {
    render(<RoundFeed showId="sheesha-ghar" roundLogs={roundLogs} onMessageReleased={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /full story/i }));

    expect(screen.getByText("The house settled into an uneasy quiet.")).toBeInTheDocument();
    expect(screen.queryByText("I trust no one.")).not.toBeInTheDocument();
    expect(screen.queryByText("Let's team up.")).not.toBeInTheDocument();
  });

  it("shows a Reveal button only on unreleased private messages, and releasing calls the API", async () => {
    const releaseSpy = vi
      .spyOn(api, "releaseMessage")
      .mockResolvedValue({ id: "m2", released: true });
    const onMessageReleased = vi.fn();

    render(<RoundFeed showId="sheesha-ghar" roundLogs={roundLogs} onMessageReleased={onMessageReleased} />);

    expect(screen.queryByRole("button", { name: /reveal/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /reveal/i }));

    await waitFor(() => expect(releaseSpy).toHaveBeenCalledWith("sheesha-ghar", "m2"));
    expect(onMessageReleased).toHaveBeenCalledWith({ id: "m2", released: true });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `frontend/src/components/RoundFeed.jsx` does not exist yet.

- [ ] **Step 3: Implement `frontend/src/components/RoundFeed.jsx`**

```javascript
import { useState } from "react";
import { releaseMessage } from "../api/client";

export default function RoundFeed({ showId, roundLogs, onMessageReleased }) {
  const [tab, setTab] = useState("live");

  async function handleReveal(messageId) {
    const updated = await releaseMessage(showId, messageId);
    onMessageReleased(updated);
  }

  return (
    <div>
      <button onClick={() => setTab("live")}>Live round feed</button>
      <button onClick={() => setTab("story")}>Full story</button>

      {tab === "live" && (
        <div>
          {roundLogs.map((log) => (
            <div key={log.round_number}>
              <h3>Round {log.round_number}</h3>
              {log.messages.map((message) => (
                <p key={message.id}>
                  {message.visibility === "private" && !message.released ? "[viewers only] " : ""}
                  {message.sender_id}: {message.text}
                  {message.visibility === "private" && !message.released && (
                    <button onClick={() => handleReveal(message.id)}>Reveal</button>
                  )}
                </p>
              ))}
            </div>
          ))}
        </div>
      )}

      {tab === "story" && (
        <div>
          {roundLogs.map((log) => (
            <p key={log.round_number}>{log.narrative}</p>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: all passed.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/RoundFeed.jsx frontend/src/components/RoundFeed.test.jsx
git commit -m "feat: add Live Round Feed and Full Story tabs"
```

---

## Not in this plan (stretch goals, build only if the above is done early)

Per the design spec §11, in priority order: stage/phase auto-pause system, per-agent-targeted producer notes, mid-show rule-editing UI, and a frontend POV toggle (the backend visibility model from Task 4 already supports it — only the UI affordance from the `glass-house-mockup.html` mockup is missing). A live-updating frontend consumer of the Task 10 WebSocket (vs. using the direct HTTP response from `advanceRound`) is also deferred — the backend broadcasts either way, so this is additive, not blocking.

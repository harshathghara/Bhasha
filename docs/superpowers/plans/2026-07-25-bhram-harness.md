# Bhram Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the harness for Bhram — an AI reality show where 5 LLM-driven agents run as concurrent tasks messaging each other publicly and privately through an event bus, moderated live by a Game Master agent, with all prompts swappable behind shipped defaults.

**Architecture:** Single-process FastAPI backend, state in memory, snapshotted to JSON per round. Each agent is an `asyncio.Task` with an inbox queue; an event bus fans public events to everyone and private events to recipients. A supervisor starts a round, and an end watcher stops it on budget exhaustion, quiescence, timeout, GM decision, or producer stop. A WebSocket streams every event to a React frontend live.

**Tech Stack:** Python 3.11+, FastAPI, OpenAI Python SDK (tool calling), pytest + pytest-asyncio + httpx, React 18 + Vite, Vitest + @testing-library/react.

## Global Constraints

- No database. State lives in memory; a JSON snapshot per round is the only persistence.
- No auth, no multi-show history, no deployment concerns. Local run only.
- Every show/agent/GM prompt must come from a `Show`/`Agent` field or `presets.py` — never a string literal buried in a runner.
- A show is created with exactly 5 agents chosen from the preset pool.
- **Visibility is enforced at exactly one place: `EventBus._is_visible_to`.** Agent inboxes are filtered there. Viewer/WebSocket payloads are never filtered — viewers see every event including unreleased private ones.
- **Quiescence requires all three:** no new events for `quiescence_seconds`, `bus.in_flight == 0`, and every inbox empty. Never use elapsed-time-alone.
- Tests must never make real network calls. Every test injects a fake LLM client and a `RoundConfig` with zeroed debounce/cooldown so suites run fast.

---

## File Structure

```
backend/
  app/
    models.py          # Event, Agent, Show, RoundConfig + enums
    presets.py          # default show/GM prompts, preset personalities
    llm_client.py        # OpenAILLMClient: complete() + complete_with_tools()
    event_bus.py         # EventBus: log, fan-out, inboxes, in_flight counter
    tools.py             # AGENT_TOOLS / GM_TOOLS OpenAI tool schemas
    agent_loop.py        # run_agent_loop(): debounce, drain, think, dispatch
    gm_loop.py           # run_gm_loop(): live subscriber, warn/eject/announce/end
    narrator.py          # run_narrator(): one recap per round
    supervisor.py        # run_round(): spawn tasks, watch for end, narrate
    store.py             # ShowStore: registry + JSON snapshot
    api.py               # FastAPI routes + WebSocket + app factory
    main.py              # uvicorn entrypoint
  tests/                 # one test module per app module
  requirements.txt
frontend/
  src/
    api/client.js
    presets.js
    components/ShowSetup.jsx
    components/LiveRoom.jsx
    components/EventFeed.jsx
  package.json
  vite.config.js
```

---

### Task 1: Core data models

**Files:**
- Create: `backend/requirements.txt`, `backend/app/__init__.py`, `backend/app/models.py`
- Test: `backend/tests/test_models.py`

**Interfaces:**
- Produces enums (all `str, Enum`): `AgentStatus` (ACTIVE/WARNED/ELIMINATED — **no PAUSED**), `ShowStatus` (SETUP/RUNNING/PAUSED/ENDED), `EventKind` (AGENT_ACTION/CONFESSION/GM_RULING/GM_ANNOUNCEMENT/NARRATION), `Visibility` (PUBLIC/PRIVATE).
- Produces `Event(seq, round, sender_id, text, kind=AGENT_ACTION, visibility=PUBLIC, recipients=[], released=False, timestamp=0.0)` with `.to_dict()`.
- Produces `Agent(id, name, personality_prompt, status=ACTIVE, warnings=0, connected_to=None, connection_note="", actions_remaining=0)` with `.to_dict()`. **Agents have no `memory` field** — knowledge is derived from the event log in Task 3.
- Produces `Show(id, title, show_prompt, gm_prompt, rules_text, contestants=[], status=SETUP, current_round=0, max_rounds=None, events=[], narratives={})` with `.get_agent(id)` (raises `KeyError`), `.active_agents()` (status ACTIVE or WARNED), `.events_for_round(n)`, `.to_dict()`.
- Produces `RoundConfig(action_budget=4, debounce_seconds=0.8, cooldown_seconds=3.0, quiescence_seconds=5.0, round_timeout_seconds=180.0, gm_review_every=3, context_window_events=60)`.
- Produces constant `GM_ID = "game_master"`.

- [ ] **Step 1: Scaffold and write the failing test**

Create `backend/requirements.txt`:

```
fastapi==0.115.0
uvicorn==0.30.6
openai==1.51.0
pytest==8.3.3
pytest-asyncio==0.24.0
httpx==0.27.2
```

Create empty `backend/app/__init__.py`. Create `backend/tests/test_models.py`:

```python
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run from `backend/`: `pip install -r requirements.txt && python -m pytest tests/test_models.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.models'`.

- [ ] **Step 3: Implement `backend/app/models.py`**

```python
from dataclasses import dataclass, field
from enum import Enum

GM_ID = "game_master"


class AgentStatus(str, Enum):
    ACTIVE = "active"
    WARNED = "warned"
    ELIMINATED = "eliminated"


class ShowStatus(str, Enum):
    SETUP = "setup"
    RUNNING = "running"
    PAUSED = "paused"
    ENDED = "ended"


class EventKind(str, Enum):
    AGENT_ACTION = "agent_action"
    CONFESSION = "confession"
    GM_RULING = "gm_ruling"
    GM_ANNOUNCEMENT = "gm_announcement"
    NARRATION = "narration"


class Visibility(str, Enum):
    PUBLIC = "public"
    PRIVATE = "private"


@dataclass
class Event:
    seq: int
    round: int
    sender_id: str
    text: str
    kind: EventKind = EventKind.AGENT_ACTION
    visibility: Visibility = Visibility.PUBLIC
    recipients: list = field(default_factory=list)
    released: bool = False
    timestamp: float = 0.0

    def to_dict(self) -> dict:
        return {
            "seq": self.seq,
            "round": self.round,
            "sender_id": self.sender_id,
            "text": self.text,
            "kind": self.kind.value,
            "visibility": self.visibility.value,
            "recipients": list(self.recipients),
            "released": self.released,
            "timestamp": self.timestamp,
        }


@dataclass
class Agent:
    id: str
    name: str
    personality_prompt: str
    status: AgentStatus = AgentStatus.ACTIVE
    warnings: int = 0
    connected_to: str = None
    connection_note: str = ""
    actions_remaining: int = 0

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "personality_prompt": self.personality_prompt,
            "status": self.status.value,
            "warnings": self.warnings,
            "connected_to": self.connected_to,
            "connection_note": self.connection_note,
            "actions_remaining": self.actions_remaining,
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
    max_rounds: int = None
    events: list = field(default_factory=list)
    narratives: dict = field(default_factory=dict)

    def get_agent(self, agent_id: str) -> Agent:
        for agent in self.contestants:
            if agent.id == agent_id:
                return agent
        raise KeyError(f"No agent with id {agent_id}")

    def active_agents(self) -> list:
        return [
            a for a in self.contestants
            if a.status in (AgentStatus.ACTIVE, AgentStatus.WARNED)
        ]

    def events_for_round(self, round_number: int) -> list:
        return [e for e in self.events if e.round == round_number]

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
            "max_rounds": self.max_rounds,
            "events": [e.to_dict() for e in self.events],
            "narratives": dict(self.narratives),
        }


@dataclass
class RoundConfig:
    action_budget: int = 4
    debounce_seconds: float = 0.8
    cooldown_seconds: float = 3.0
    quiescence_seconds: float = 5.0
    round_timeout_seconds: float = 180.0
    gm_review_every: int = 3
    context_window_events: int = 60
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/test_models.py -v`
Expected: 7 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/requirements.txt backend/app/__init__.py backend/app/models.py backend/tests/test_models.py
git commit -m "feat: add core Event/Agent/Show data models"
```

---

### Task 2: Preset library

**Files:**
- Create: `backend/app/presets.py`
- Test: `backend/tests/test_presets.py`

**Interfaces:**
- Consumes `Agent`, `AgentStatus` (Task 1).
- Produces `DEFAULT_SHOW_PROMPT`, `DEFAULT_GM_PROMPT`, `DEFAULT_RULES_TEXT` (all non-empty `str`).
- Produces `PRESET_AGENT_PERSONALITIES: list[dict]` — exactly 8 entries of `{"id", "name", "personality_prompt"}`.
- Produces `build_preset_agent(preset_id) -> Agent` (raises `KeyError`).

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_presets.py`:

```python
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/test_presets.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.presets'`.

- [ ] **Step 3: Implement `backend/app/presets.py`**

```python
from .models import Agent, AgentStatus

DEFAULT_SHOW_PROMPT = (
    "Five strangers live together in a house under constant observation. "
    "They can speak to the whole house or privately to each other. Alliances "
    "form and break. The Game Master watches everything and can warn or "
    "remove anyone who breaks the house rules."
)

DEFAULT_GM_PROMPT = (
    "You are the Game Master of a reality show. You are fair but firm. You "
    "enforce the house rules exactly as written and never play favorites. "
    "Interject only when it matters: a rule was broken, or the house needs "
    "direction. Explain every ruling in one or two sentences. End the round "
    "when the drama has peaked or the conversation has run its course."
)

DEFAULT_RULES_TEXT = (
    "1. No agent may accuse another of an action without stating what "
    "evidence they have.\n"
    "2. Direct insults with no strategic content are not allowed.\n"
    "3. No agent may claim the Game Master has given them a private "
    "instruction."
)

PRESET_AGENT_PERSONALITIES = [
    {"id": "strategist", "name": "The Strategist",
     "personality_prompt": "You calculate every move for advantage. You are "
     "calm, a little cold, and you respect competence over loyalty."},
    {"id": "diplomat", "name": "The Diplomat",
     "personality_prompt": "You want the group to get along. You mediate "
     "conflict, but you are quietly building your own position while you do it."},
    {"id": "loyalist", "name": "The Loyalist",
     "personality_prompt": "You trust your allies completely and rarely "
     "question them, even when you probably should."},
    {"id": "operator", "name": "The Operator",
     "personality_prompt": "You tell each ally what they want to hear. You "
     "maintain several private alliances at once and rarely let one "
     "conversation contradict another in public."},
    {"id": "wildcard", "name": "The Wildcard",
     "personality_prompt": "You are unpredictable and act on impulse. You "
     "enjoy chaos and are honest about it, sometimes to your own detriment."},
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
git commit -m "feat: add default prompts and preset agent pool"
```

---

### Task 3: Event bus

**Files:**
- Create: `backend/app/event_bus.py`
- Test: `backend/tests/test_event_bus.py`

**Interfaces:**
- Consumes `Event`, `EventKind`, `Visibility`, `GM_ID` (Task 1).
- Produces `EventBus(show)` with:
  - `.subscribe(subscriber_id) -> asyncio.Queue`
  - `.unsubscribe(subscriber_id)`
  - `.publish(sender_id, text, kind=AGENT_ACTION, visibility=PUBLIC, recipients=None) -> Event` — assigns `seq = len(show.events)`, appends to `show.events`, fans out to visible inboxes, then calls every listener with the event **unfiltered**.
  - `.add_listener(fn)` — viewer/WebSocket hook. Listeners see every event.
  - `.in_flight: int` — incremented before each LLM call by the loops, decremented after. Read by the end watcher.
  - `.all_inboxes_empty() -> bool`
  - `.can_see(event, subscriber_id) -> bool` — entitlement. `GM_ID` sees everything; an agent sees its own events, all public and released events, and private events naming it as a recipient.
  - `.visible_events_for(subscriber_id, limit=None) -> list[Event]` — the log filtered by `can_see`, optionally the last `limit` only. **This is how agent context is built** (Task 6), replacing per-agent accumulated memory.
- **This is the only place visibility is enforced.** `_is_visible_to` is `can_see` minus self-echo, and governs inbox fan-out only; an agent should not be woken by its own words, but must still remember saying them.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_event_bus.py`:

```python
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/test_event_bus.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.event_bus'`.

- [ ] **Step 3: Implement `backend/app/event_bus.py`**

```python
import asyncio
import time

from .models import Event, EventKind, Visibility, GM_ID


class EventBus:
    def __init__(self, show):
        self.show = show
        self.inboxes = {}
        self.listeners = []
        self.in_flight = 0

    def subscribe(self, subscriber_id: str) -> asyncio.Queue:
        queue = asyncio.Queue()
        self.inboxes[subscriber_id] = queue
        return queue

    def unsubscribe(self, subscriber_id: str) -> None:
        self.inboxes.pop(subscriber_id, None)

    def add_listener(self, listener) -> None:
        self.listeners.append(listener)

    def all_inboxes_empty(self) -> bool:
        return all(queue.empty() for queue in self.inboxes.values())

    def can_see(self, event: Event, subscriber_id: str) -> bool:
        """Whether this subscriber is entitled to know about this event at all."""
        if subscriber_id == GM_ID:
            return True
        if subscriber_id == event.sender_id:
            return True
        if event.visibility == Visibility.PUBLIC or event.released:
            return True
        return subscriber_id in event.recipients

    def visible_events_for(self, subscriber_id: str, limit: int = None) -> list:
        events = [e for e in self.show.events if self.can_see(e, subscriber_id)]
        if limit is not None:
            return events[-limit:]
        return events

    def publish(self, sender_id: str, text: str,
                kind: EventKind = EventKind.AGENT_ACTION,
                visibility: Visibility = Visibility.PUBLIC,
                recipients: list = None) -> Event:
        event = Event(
            seq=len(self.show.events),
            round=self.show.current_round,
            sender_id=sender_id,
            text=text,
            kind=kind,
            visibility=visibility,
            recipients=list(recipients or []),
            timestamp=time.time(),
        )
        self.show.events.append(event)

        for subscriber_id, queue in self.inboxes.items():
            if self._is_visible_to(event, subscriber_id):
                queue.put_nowait(event)

        for listener in self.listeners:
            listener(event)

        return event

    def _is_visible_to(self, event: Event, subscriber_id: str) -> bool:
        """Inbox fan-out: entitlement, minus self-echo. An agent is never woken
        by its own words, but visible_events_for still remembers them."""
        if subscriber_id == event.sender_id:
            return False
        return self.can_see(event, subscriber_id)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/test_event_bus.py -v`
Expected: 10 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/app/event_bus.py backend/tests/test_event_bus.py
git commit -m "feat: add event bus with visibility-filtered fan-out"
```

---

### Task 4: Tool schemas

**Files:**
- Create: `backend/app/tools.py`
- Test: `backend/tests/test_tools.py`

**Interfaces:**
- Produces `AGENT_TOOLS: list[dict]` — OpenAI tool schemas for `speak_public(text)`, `send_private(to, text)`, `confess(text)`, `stay_silent()`.
- Produces `GM_TOOLS: list[dict]` — `warn(agent_id, reason)`, `eject(agent_id, reason)`, `announce(text)`, `end_round(reason)`.
- Produces `tool_names(tools) -> set[str]`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_tools.py`:

```python
from app.tools import AGENT_TOOLS, GM_TOOLS, tool_names


def test_agent_tools_expose_the_four_actions():
    assert tool_names(AGENT_TOOLS) == {
        "speak_public", "send_private", "confess", "stay_silent",
    }


def test_gm_tools_expose_the_four_powers():
    assert tool_names(GM_TOOLS) == {"warn", "eject", "announce", "end_round"}


def test_send_private_requires_to_and_text():
    schema = next(t for t in AGENT_TOOLS if t["function"]["name"] == "send_private")
    required = schema["function"]["parameters"]["required"]
    assert set(required) == {"to", "text"}


def test_every_tool_is_a_well_formed_openai_function_schema():
    for tool in AGENT_TOOLS + GM_TOOLS:
        assert tool["type"] == "function"
        assert tool["function"]["name"]
        assert tool["function"]["description"]
        assert tool["function"]["parameters"]["type"] == "object"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/test_tools.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.tools'`.

- [ ] **Step 3: Implement `backend/app/tools.py`**

```python
def _function(name: str, description: str, properties: dict, required: list) -> dict:
    return {
        "type": "function",
        "function": {
            "name": name,
            "description": description,
            "parameters": {
                "type": "object",
                "properties": properties,
                "required": required,
            },
        },
    }


AGENT_TOOLS = [
    _function(
        "speak_public",
        "Say something out loud to the whole house. Everyone hears it.",
        {"text": {"type": "string", "description": "What you say out loud."}},
        ["text"],
    ),
    _function(
        "send_private",
        "Send a private message to one other housemate. Nobody else hears it.",
        {
            "to": {"type": "string", "description": "The agent id of the recipient."},
            "text": {"type": "string", "description": "What you say privately."},
        },
        ["to", "text"],
    ),
    _function(
        "confess",
        "Record a private thought in the confession booth. No housemate ever "
        "hears this, but the viewing audience does.",
        {"text": {"type": "string", "description": "Your private thought."}},
        ["text"],
    ),
    _function(
        "stay_silent",
        "Decide that nothing here is worth responding to right now.",
        {},
        [],
    ),
]

GM_TOOLS = [
    _function(
        "warn",
        "Publicly warn a housemate for breaking a house rule.",
        {
            "agent_id": {"type": "string", "description": "Who is being warned."},
            "reason": {"type": "string", "description": "Why, in one or two sentences."},
        },
        ["agent_id", "reason"],
    ),
    _function(
        "eject",
        "Remove a housemate from the show immediately for a serious or "
        "repeated rule violation.",
        {
            "agent_id": {"type": "string", "description": "Who is being removed."},
            "reason": {"type": "string", "description": "Why, in one or two sentences."},
        },
        ["agent_id", "reason"],
    ),
    _function(
        "announce",
        "Make a public announcement to the whole house.",
        {"text": {"type": "string", "description": "The announcement."}},
        ["text"],
    ),
    _function(
        "end_round",
        "Call time on this round. Use when the drama has peaked or the "
        "conversation has run its course.",
        {"reason": {"type": "string", "description": "Why you are ending the round."}},
        ["reason"],
    ),
]


def tool_names(tools: list) -> set:
    return {tool["function"]["name"] for tool in tools}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/test_tools.py -v`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/app/tools.py backend/tests/test_tools.py
git commit -m "feat: add agent and game master tool schemas"
```

---

### Task 5: LLM client with tool calling

**Files:**
- Create: `backend/app/llm_client.py`
- Test: `backend/tests/test_llm_client.py`

**Interfaces:**
- Produces `OpenAILLMClient(model="gpt-4o-mini", api_key=None)` with:
  - `.complete(system_prompt, user_prompt) -> str` — plain text, used by the narrator.
  - `.complete_with_tools(system_prompt, user_prompt, tools) -> list[dict]` — returns `[{"name": str, "arguments": dict}, ...]`, empty list if the model made no tool calls. Malformed JSON in an argument payload is skipped rather than raising, so one bad call cannot kill an agent's loop.
- This is the only module importing `openai`. Every consumer accepts any object with these two methods, which is what makes the loops testable with fakes.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_llm_client.py`:

```python
import json
from unittest.mock import MagicMock, patch

from app.llm_client import OpenAILLMClient


def make_tool_call(name, arguments_json):
    call = MagicMock()
    call.function.name = name
    call.function.arguments = arguments_json
    return call


def test_complete_returns_message_content():
    response = MagicMock()
    response.choices = [MagicMock(message=MagicMock(content="a recap"))]

    with patch("app.llm_client.OpenAI") as mock_openai:
        mock_openai.return_value.chat.completions.create.return_value = response
        client = OpenAILLMClient(api_key="test-key")
        assert client.complete("system", "user") == "a recap"


def test_complete_with_tools_parses_calls():
    message = MagicMock()
    message.tool_calls = [
        make_tool_call("speak_public", json.dumps({"text": "hello"})),
        make_tool_call("send_private", json.dumps({"to": "meera", "text": "psst"})),
    ]
    response = MagicMock()
    response.choices = [MagicMock(message=message)]

    with patch("app.llm_client.OpenAI") as mock_openai:
        mock_openai.return_value.chat.completions.create.return_value = response
        client = OpenAILLMClient(api_key="test-key")
        calls = client.complete_with_tools("system", "user", [{"type": "function"}])

    assert calls == [
        {"name": "speak_public", "arguments": {"text": "hello"}},
        {"name": "send_private", "arguments": {"to": "meera", "text": "psst"}},
    ]


def test_complete_with_tools_returns_empty_when_no_tool_calls():
    message = MagicMock()
    message.tool_calls = None
    response = MagicMock()
    response.choices = [MagicMock(message=message)]

    with patch("app.llm_client.OpenAI") as mock_openai:
        mock_openai.return_value.chat.completions.create.return_value = response
        client = OpenAILLMClient(api_key="test-key")
        assert client.complete_with_tools("system", "user", []) == []


def test_complete_with_tools_skips_malformed_arguments():
    message = MagicMock()
    message.tool_calls = [
        make_tool_call("speak_public", "{not valid json"),
        make_tool_call("confess", json.dumps({"text": "ok"})),
    ]
    response = MagicMock()
    response.choices = [MagicMock(message=message)]

    with patch("app.llm_client.OpenAI") as mock_openai:
        mock_openai.return_value.chat.completions.create.return_value = response
        client = OpenAILLMClient(api_key="test-key")
        calls = client.complete_with_tools("system", "user", [])

    assert calls == [{"name": "confess", "arguments": {"text": "ok"}}]
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/test_llm_client.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.llm_client'`.

- [ ] **Step 3: Implement `backend/app/llm_client.py`**

```python
import json
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

    def complete_with_tools(self, system_prompt: str, user_prompt: str,
                            tools: list) -> list:
        response = self.client.chat.completions.create(
            model=self.model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            tools=tools,
        )
        message = response.choices[0].message
        calls = []
        for tool_call in message.tool_calls or []:
            try:
                arguments = json.loads(tool_call.function.arguments)
            except (json.JSONDecodeError, TypeError):
                continue
            calls.append({"name": tool_call.function.name, "arguments": arguments})
        return calls
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/test_llm_client.py -v`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/app/llm_client.py backend/tests/test_llm_client.py
git commit -m "feat: add OpenAI client with tool calling support"
```

---

### Task 6: Agent loop

**Files:**
- Create: `backend/app/agent_loop.py`
- Test: `backend/tests/test_agent_loop.py`

**Interfaces:**
- Consumes `EventBus` (Task 3), `AGENT_TOOLS` (Task 4), models and `RoundConfig` (Task 1), any client with `.complete_with_tools()` (Task 5).
- Produces `build_agent_prompt(show, agent, bus, config) -> tuple[str, str]` — system prompt carries personality, show premise, rules, roster, and the secret connection note if `agent.connected_to` is set. User prompt is built from `bus.visible_events_for(agent.id, config.context_window_events)`, **not** from the drained inbox batch. This is the gap-1 fix: an agent that has spent its budget and stopped receiving inbox events still sees everything that happened while it was quiet, because context comes from the log.
- Produces `dispatch_agent_calls(bus, agent, calls) -> int` — publishes each tool call to the bus, returns how many events were published. `stay_silent` publishes nothing.
- Produces `async def run_agent_loop(show, agent, bus, llm_client, config)` — subscribes, then loops: block on inbox, debounce, drain (purely to consume the wake signal), one LLM call wrapped in `bus.in_flight` tracking, dispatch, decrement `actions_remaining`, cooldown. Exits when budget is spent, the agent is eliminated, or the task is cancelled. Always unsubscribes on exit.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_agent_loop.py`:

```python
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/test_agent_loop.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.agent_loop'`.

- [ ] **Step 3: Implement `backend/app/agent_loop.py`**

```python
import asyncio

from .models import AgentStatus, EventKind, Visibility
from .tools import AGENT_TOOLS


def build_agent_prompt(show, agent, bus, config) -> tuple:
    connection_line = ""
    if agent.connected_to:
        connection_line = (
            f"\nSomething only you know: {agent.connection_note} "
            "Nobody else in the house knows this connection exists."
        )

    housemates = ", ".join(
        f"{a.name} (id: {a.id})" for a in show.active_agents() if a.id != agent.id
    )

    system_prompt = (
        f"You are {agent.name} in a reality show.\n"
        f"{agent.personality_prompt}\n\n"
        f"Show premise: {show.show_prompt}\n"
        f"House rules: {show.rules_text}\n"
        f"Other housemates: {housemates}"
        f"{connection_line}\n\n"
        "Use the tools to act. You may use several in one turn: speak to the "
        "house, send private messages, and record a confession. If nothing "
        "here deserves a response, use stay_silent."
    )

    visible = bus.visible_events_for(agent.id, config.context_window_events)
    history = "\n".join(_format_event(event, agent) for event in visible)

    user_prompt = (
        f"Everything you have seen and said so far:\n"
        f"{history or '(nothing yet)'}\n\n"
        f"It is round {show.current_round}. Decide how you want to act."
    )
    return system_prompt, user_prompt


def _format_event(event, agent) -> str:
    if event.kind == EventKind.GM_RULING:
        return f"[GAME MASTER RULING] {event.text}"
    if event.kind == EventKind.GM_ANNOUNCEMENT:
        return f"[GAME MASTER] {event.text}"
    if event.kind == EventKind.CONFESSION:
        return f"[your own private thought] {event.text}"
    if event.sender_id == agent.id:
        if event.visibility == Visibility.PRIVATE and not event.released:
            return f"[you, privately to {event.recipients}] {event.text}"
        return f"[you] {event.text}"
    if event.visibility == Visibility.PRIVATE and not event.released:
        return f"[PRIVATE from {event.sender_id}] {event.text}"
    return f"{event.sender_id}: {event.text}"


def dispatch_agent_calls(bus, agent, calls) -> int:
    published = 0
    for call in calls:
        name = call["name"]
        arguments = call.get("arguments", {})
        if name == "speak_public":
            bus.publish(agent.id, arguments["text"])
        elif name == "send_private":
            bus.publish(agent.id, arguments["text"],
                        visibility=Visibility.PRIVATE,
                        recipients=[arguments["to"]])
        elif name == "confess":
            bus.publish(agent.id, arguments["text"], kind=EventKind.CONFESSION,
                        visibility=Visibility.PRIVATE, recipients=[])
        else:
            continue
        published += 1
    return published


def _drain(inbox) -> list:
    drained = []
    while not inbox.empty():
        drained.append(inbox.get_nowait())
    return drained


async def run_agent_loop(show, agent, bus, llm_client, config) -> None:
    inbox = bus.subscribe(agent.id)
    try:
        while agent.actions_remaining > 0:
            if agent.status == AgentStatus.ELIMINATED:
                return

            # The inbox is only a wake signal. Draining it says "something
            # happened"; the context itself is rebuilt from the log below.
            await inbox.get()
            if config.debounce_seconds:
                await asyncio.sleep(config.debounce_seconds)
            _drain(inbox)

            if agent.status == AgentStatus.ELIMINATED:
                return

            system_prompt, user_prompt = build_agent_prompt(show, agent, bus, config)

            bus.in_flight += 1
            try:
                calls = await asyncio.get_event_loop().run_in_executor(
                    None, llm_client.complete_with_tools,
                    system_prompt, user_prompt, AGENT_TOOLS,
                )
            finally:
                bus.in_flight -= 1

            dispatch_agent_calls(bus, agent, calls)

            agent.actions_remaining -= 1
            if config.cooldown_seconds:
                await asyncio.sleep(config.cooldown_seconds)
    except asyncio.CancelledError:
        pass
    finally:
        bus.unsubscribe(agent.id)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/test_agent_loop.py -v`
Expected: 11 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/app/agent_loop.py backend/tests/test_agent_loop.py
git commit -m "feat: add concurrent agent loop with debounce, drain, and dispatch"
```

---

### Task 7: Game Master loop

**Files:**
- Create: `backend/app/gm_loop.py`
- Test: `backend/tests/test_gm_loop.py`

**Interfaces:**
- Consumes `EventBus` (Task 3), `GM_TOOLS` (Task 4), models (Task 1).
- Produces `build_gm_prompt(show, batch) -> tuple[str, str]` — the GM sees private events and confessions verbatim.
- Produces `dispatch_gm_calls(show, bus, calls, stop_event) -> None` — `warn` increments `warnings` and sets status WARNED; `eject` sets status ELIMINATED; both publish a public `GM_RULING`. `announce` publishes a public `GM_ANNOUNCEMENT`. `end_round` publishes an announcement and sets `stop_event`.
- Produces `async def run_gm_loop(show, bus, llm_client, config, stop_event)` — subscribes as `GM_ID`, counts events seen, and thinks once every `config.gm_review_every` events.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_gm_loop.py`:

```python
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/test_gm_loop.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.gm_loop'`.

- [ ] **Step 3: Implement `backend/app/gm_loop.py`**

```python
import asyncio

from .models import AgentStatus, EventKind, Visibility, GM_ID
from .tools import GM_TOOLS


def build_gm_prompt(show, batch) -> tuple:
    roster = ", ".join(
        f"{a.name} (id: {a.id}, status: {a.status.value}, warnings: {a.warnings})"
        for a in show.contestants
    )

    system_prompt = (
        f"{show.gm_prompt}\n\n"
        f"Show premise: {show.show_prompt}\n"
        f"House rules you enforce: {show.rules_text}\n"
        f"Housemates: {roster}\n\n"
        "You see everything, including private messages and confessions the "
        "housemates believe are secret. Use the tools only when action is "
        "warranted. Doing nothing is usually correct."
    )

    lines = []
    for event in batch:
        if event.kind == EventKind.CONFESSION:
            lines.append(f"[CONFESSION by {event.sender_id}] {event.text}")
        elif event.visibility == Visibility.PRIVATE:
            lines.append(
                f"[PRIVATE {event.sender_id} -> {event.recipients}] {event.text}"
            )
        else:
            lines.append(f"{event.sender_id}: {event.text}")

    user_prompt = (
        "Recent activity in the house:\n" + ("\n".join(lines) or "(nothing yet)")
    )
    return system_prompt, user_prompt


def dispatch_gm_calls(show, bus, calls, stop_event) -> None:
    for call in calls:
        name = call["name"]
        arguments = call.get("arguments", {})
        if name in ("warn", "eject"):
            try:
                agent = show.get_agent(arguments["agent_id"])
            except KeyError:
                continue
            if name == "warn":
                agent.warnings += 1
                agent.status = AgentStatus.WARNED
            else:
                agent.status = AgentStatus.ELIMINATED
            bus.publish(GM_ID, arguments["reason"], kind=EventKind.GM_RULING)
        elif name == "announce":
            bus.publish(GM_ID, arguments["text"], kind=EventKind.GM_ANNOUNCEMENT)
        elif name == "end_round":
            bus.publish(GM_ID, arguments["reason"], kind=EventKind.GM_ANNOUNCEMENT)
            stop_event.set()


def _drain(inbox) -> list:
    drained = []
    while not inbox.empty():
        drained.append(inbox.get_nowait())
    return drained


async def run_gm_loop(show, bus, llm_client, config, stop_event) -> None:
    inbox = bus.subscribe(GM_ID)
    seen_since_review = 0
    try:
        while not stop_event.is_set():
            first = await inbox.get()
            batch = [first] + _drain(inbox)
            seen_since_review += len(batch)
            if seen_since_review < config.gm_review_every:
                continue
            seen_since_review = 0

            system_prompt, user_prompt = build_gm_prompt(show, batch)
            bus.in_flight += 1
            try:
                calls = await asyncio.get_event_loop().run_in_executor(
                    None, llm_client.complete_with_tools,
                    system_prompt, user_prompt, GM_TOOLS,
                )
            finally:
                bus.in_flight -= 1

            dispatch_gm_calls(show, bus, calls, stop_event)
    except asyncio.CancelledError:
        pass
    finally:
        bus.unsubscribe(GM_ID)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/test_gm_loop.py -v`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/app/gm_loop.py backend/tests/test_gm_loop.py
git commit -m "feat: add live game master loop with warn, eject, and end round"
```

---

### Task 8: Narrator

**Files:**
- Create: `backend/app/narrator.py`
- Test: `backend/tests/test_narrator.py`

**Interfaces:**
- Consumes models (Task 1), any client with `.complete()` (Task 5).
- Produces `build_narrator_prompt(show, events) -> tuple[str, str]` — public events and GM rulings only; unreleased private events and confessions are excluded.
- Produces `run_narrator(show, events, llm_client) -> str` — stripped recap text.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_narrator.py`:

```python
from app.models import Event, EventKind, Show, Visibility
from app.narrator import build_narrator_prompt, run_narrator


class FakeLLMClient:
    def __init__(self, text):
        self.text = text

    def complete(self, system_prompt, user_prompt):
        return self.text


def make_show():
    return Show(id="s1", title="T", show_prompt="p", gm_prompt="g",
                rules_text="r", current_round=1)


def test_narrator_prompt_excludes_unreleased_private_and_confessions():
    show = make_show()
    events = [
        Event(seq=0, round=1, sender_id="vikram", text="I trust no one."),
        Event(seq=1, round=1, sender_id="meera", text="Secret alliance plan.",
              visibility=Visibility.PRIVATE, recipients=["vikram"]),
        Event(seq=2, round=1, sender_id="meera", text="I am terrified.",
              kind=EventKind.CONFESSION, visibility=Visibility.PRIVATE),
        Event(seq=3, round=1, sender_id="game_master", text="Vikram warned.",
              kind=EventKind.GM_RULING),
    ]

    _, user_prompt = build_narrator_prompt(show, events)

    assert "I trust no one." in user_prompt
    assert "Vikram warned." in user_prompt
    assert "Secret alliance plan." not in user_prompt
    assert "I am terrified." not in user_prompt


def test_narrator_prompt_includes_released_private_event():
    show = make_show()
    events = [
        Event(seq=0, round=1, sender_id="meera", text="Leaked plan.",
              visibility=Visibility.PRIVATE, recipients=["vikram"], released=True),
    ]
    _, user_prompt = build_narrator_prompt(show, events)
    assert "Leaked plan." in user_prompt


def test_narrator_prompt_carries_the_one_good_deed_rule():
    show = make_show()
    system_prompt, _ = build_narrator_prompt(show, [])
    assert "act of kindness" in system_prompt.lower()


def test_run_narrator_strips_whitespace():
    show = make_show()
    assert run_narrator(show, [], FakeLLMClient("  A tense round.  \n")) == "A tense round."
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/test_narrator.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.narrator'`.

- [ ] **Step 3: Implement `backend/app/narrator.py`**

```python
from .models import EventKind, Visibility


def build_narrator_prompt(show, events) -> tuple:
    system_prompt = (
        "You are the narrator of a reality show. Write a short third-person "
        "recap paragraph, three to five sentences, of this round for the "
        "viewing audience. Do not invent facts that are not in the round "
        "content. No matter how hostile the round was, find and highlight at "
        "least one authentic act of kindness, courage, or loyalty from what "
        "actually happened. Do not fabricate one if there genuinely was none."
    )

    lines = []
    for event in events:
        if event.kind == EventKind.CONFESSION:
            continue
        if event.visibility == Visibility.PRIVATE and not event.released:
            continue
        lines.append(f"{event.sender_id}: {event.text}")

    user_prompt = (
        f"Round {show.current_round} content:\n"
        + ("\n".join(lines) or "(the house was silent)")
    )
    return system_prompt, user_prompt


def run_narrator(show, events, llm_client) -> str:
    system_prompt, user_prompt = build_narrator_prompt(show, events)
    return llm_client.complete(system_prompt, user_prompt).strip()
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/test_narrator.py -v`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/app/narrator.py backend/tests/test_narrator.py
git commit -m "feat: add narrator with visibility filtering and good deed rule"
```

---

### Task 9: Show store

**Files:**
- Create: `backend/app/store.py`
- Test: `backend/tests/test_store.py`

**Interfaces:**
- Produces `ShowStore(snapshot_dir="snapshots")` with `.add(show)`, `.get(show_id)` (raises `KeyError`), `.snapshot(show_id)` writing `{snapshot_dir}/{show_id}.json`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_store.py`:

```python
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/test_store.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.store'`.

- [ ] **Step 3: Implement `backend/app/store.py`**

```python
import json
from pathlib import Path


class ShowStore:
    def __init__(self, snapshot_dir: str = "snapshots"):
        self.shows = {}
        self.snapshot_dir = Path(snapshot_dir)
        self.snapshot_dir.mkdir(parents=True, exist_ok=True)

    def add(self, show) -> None:
        self.shows[show.id] = show

    def get(self, show_id: str):
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

### Task 10: Round supervisor and end watcher

**Files:**
- Create: `backend/app/supervisor.py`
- Test: `backend/tests/test_supervisor.py`

**Interfaces:**
- Consumes `run_agent_loop` (Task 6), `run_gm_loop` (Task 7), `run_narrator` (Task 8), `EventBus` (Task 3), `ShowStore` (Task 9), models (Task 1).
- Produces `async def watch_for_end(show, bus, config, stop_event, started_at)` — polls every 250ms and sets `stop_event` on wall-clock timeout, all budgets exhausted, or true quiescence (no new events for `quiescence_seconds` **and** `bus.in_flight == 0` **and** `bus.all_inboxes_empty()`).
- Produces `async def run_round(show, bus, llm_client, config, store=None, stop_event=None) -> str` — increments the round, resets budgets, spawns agent and GM tasks, publishes the GM kickoff announcement, awaits `stop_event`, cancels tasks, runs the narrator, stores the narrative, snapshots, and returns the narrative. Accepting an externally supplied `stop_event` is what makes the producer-stop route in Task 11 possible.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_supervisor.py`:

```python
import asyncio

import pytest

from app.event_bus import EventBus
from app.models import Agent, AgentStatus, EventKind, RoundConfig, Show
from app.supervisor import run_round, watch_for_end


def make_show():
    agents = [
        Agent(id="vikram", name="Vikram", personality_prompt="p"),
        Agent(id="meera", name="Meera", personality_prompt="p"),
    ]
    return Show(id="s1", title="T", show_prompt="p", gm_prompt="g",
                rules_text="r", contestants=agents)


def fast_config(**overrides):
    defaults = dict(
        action_budget=1, debounce_seconds=0.0, cooldown_seconds=0.0,
        quiescence_seconds=0.1, round_timeout_seconds=5.0, gm_review_every=100,
    )
    defaults.update(overrides)
    return RoundConfig(**defaults)


class SilentClient:
    """Agents stay silent; narrator returns a fixed recap."""

    def complete_with_tools(self, system_prompt, user_prompt, tools):
        return []

    def complete(self, system_prompt, user_prompt):
        return "A quiet round in the house."


class TalkativeClient:
    def complete_with_tools(self, system_prompt, user_prompt, tools):
        return [{"name": "speak_public", "arguments": {"text": "I am here."}}]

    def complete(self, system_prompt, user_prompt):
        return "Everyone spoke up."


@pytest.mark.asyncio
async def test_run_round_publishes_kickoff_and_runs_agents():
    show = make_show()
    bus = EventBus(show)

    narrative = await asyncio.wait_for(
        run_round(show, bus, TalkativeClient(), fast_config()), timeout=10
    )

    assert show.current_round == 1
    assert show.events[0].kind == EventKind.GM_ANNOUNCEMENT
    spoken = [e.text for e in show.events if e.sender_id in ("vikram", "meera")]
    assert spoken == ["I am here.", "I am here."]
    assert narrative == "Everyone spoke up."
    assert show.narratives[1] == "Everyone spoke up."


@pytest.mark.asyncio
async def test_run_round_ends_on_quiescence_when_agents_stay_silent():
    show = make_show()
    bus = EventBus(show)

    narrative = await asyncio.wait_for(
        run_round(show, bus, SilentClient(), fast_config(action_budget=5)),
        timeout=10,
    )

    assert narrative == "A quiet round in the house."


@pytest.mark.asyncio
async def test_run_round_resets_action_budget_for_active_agents_only():
    show = make_show()
    show.get_agent("meera").status = AgentStatus.ELIMINATED
    bus = EventBus(show)

    await asyncio.wait_for(
        run_round(show, bus, SilentClient(), fast_config(action_budget=3)),
        timeout=10,
    )

    assert show.get_agent("meera").actions_remaining == 0
    assert show.get_agent("meera").status == AgentStatus.ELIMINATED


@pytest.mark.asyncio
async def test_run_round_snapshots_when_store_given(tmp_path):
    from app.store import ShowStore

    show = make_show()
    bus = EventBus(show)
    store = ShowStore(snapshot_dir=str(tmp_path))
    store.add(show)

    await asyncio.wait_for(
        run_round(show, bus, SilentClient(), fast_config(), store=store), timeout=10
    )

    assert (tmp_path / "s1.json").exists()


@pytest.mark.asyncio
async def test_external_stop_event_ends_the_round():
    show = make_show()
    bus = EventBus(show)
    stop_event = asyncio.Event()

    async def stop_soon():
        await asyncio.sleep(0.05)
        stop_event.set()

    asyncio.create_task(stop_soon())
    await asyncio.wait_for(
        run_round(show, bus, SilentClient(),
                  fast_config(quiescence_seconds=30.0, round_timeout_seconds=30.0),
                  stop_event=stop_event),
        timeout=10,
    )

    assert show.current_round == 1


@pytest.mark.asyncio
async def test_watch_for_end_does_not_fire_quiescence_while_calls_in_flight():
    show = make_show()
    for agent in show.contestants:
        agent.actions_remaining = 5   # keep the budget rail from firing first
    bus = EventBus(show)
    stop_event = asyncio.Event()
    bus.in_flight = 1

    watcher = asyncio.create_task(
        watch_for_end(show, bus, fast_config(quiescence_seconds=0.05),
                      stop_event, asyncio.get_event_loop().time())
    )
    await asyncio.sleep(0.3)
    still_running = not stop_event.is_set()

    bus.in_flight = 0
    await asyncio.sleep(0.3)
    fired_after_settling = stop_event.is_set()

    watcher.cancel()
    await asyncio.gather(watcher, return_exceptions=True)

    assert still_running is True
    assert fired_after_settling is True
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/test_supervisor.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.supervisor'`.

- [ ] **Step 3: Implement `backend/app/supervisor.py`**

```python
import asyncio

from .agent_loop import run_agent_loop
from .gm_loop import run_gm_loop
from .models import EventKind, GM_ID
from .narrator import run_narrator

WATCH_POLL_SECONDS = 0.25


async def watch_for_end(show, bus, config, stop_event, started_at) -> None:
    loop = asyncio.get_event_loop()
    last_event_count = len(show.events)
    last_change_at = loop.time()

    try:
        while not stop_event.is_set():
            await asyncio.sleep(WATCH_POLL_SECONDS)
            now = loop.time()

            if now - started_at > config.round_timeout_seconds:
                stop_event.set()
                return

            active = show.active_agents()
            if active and all(a.actions_remaining <= 0 for a in active):
                stop_event.set()
                return

            if len(show.events) != last_event_count:
                last_event_count = len(show.events)
                last_change_at = now
                continue

            settled = bus.in_flight == 0 and bus.all_inboxes_empty()
            if settled and now - last_change_at > config.quiescence_seconds:
                stop_event.set()
                return
    except asyncio.CancelledError:
        pass


async def run_round(show, bus, llm_client, config, store=None,
                    stop_event=None) -> str:
    show.current_round += 1
    active = show.active_agents()
    for agent in active:
        agent.actions_remaining = config.action_budget

    stop_event = stop_event or asyncio.Event()
    loop = asyncio.get_event_loop()

    agent_tasks = [
        asyncio.create_task(run_agent_loop(show, agent, bus, llm_client, config))
        for agent in active
    ]
    gm_task = asyncio.create_task(
        run_gm_loop(show, bus, llm_client, config, stop_event)
    )
    await asyncio.sleep(0)

    bus.publish(
        GM_ID,
        f"Round {show.current_round} begins. The house is open.",
        kind=EventKind.GM_ANNOUNCEMENT,
    )

    watcher = asyncio.create_task(
        watch_for_end(show, bus, config, stop_event, loop.time())
    )

    await stop_event.wait()

    for task in agent_tasks + [gm_task, watcher]:
        task.cancel()
    await asyncio.gather(*agent_tasks, gm_task, watcher, return_exceptions=True)

    narrative = run_narrator(
        show, show.events_for_round(show.current_round), llm_client
    )
    show.narratives[show.current_round] = narrative

    if store is not None:
        store.snapshot(show.id)

    return narrative
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/test_supervisor.py -v`
Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/app/supervisor.py backend/tests/test_supervisor.py
git commit -m "feat: add round supervisor with budget, quiescence, and timeout end conditions"
```

---

### Task 11: FastAPI routes, WebSocket streaming, entrypoint

**Files:**
- Create: `backend/app/api.py`, `backend/app/main.py`
- Test: `backend/tests/test_api.py`

**Interfaces:**
- Consumes everything above.
- Produces `create_app(store, llm_client, config=None) -> FastAPI` with:
  - `POST /shows` — body `{title, show_prompt?, gm_prompt?, rules_text?, max_rounds?, secret_connections?, agent_preset_ids: [str] * 5}` → `Show.to_dict()`; `400` unless exactly 5 preset ids. Each `secret_connections` entry `{agent_a, agent_b, connection_note}` sets a symmetric Mirror Pair.
  - `GET /shows/{show_id}` → `Show.to_dict()`.
  - `POST /shows/{show_id}/rounds` → runs one round to completion, returns `{"round": int, "narrative": str}`; `409` if `max_rounds` already reached, which also sets status ENDED.
  - `POST /shows/{show_id}/stop` → sets the active round's stop event, returns `{"stopped": bool}`.
  - `POST /shows/{show_id}/agents/{agent_id}/kill` → `Agent.to_dict()`.
  - `POST /shows/{show_id}/events/{seq}/release` → `Event.to_dict()` with `released=True`; `404` if no such seq.
  - `WS /ws/{show_id}` — every event published during a round is pushed unfiltered as it happens.
- Produces `backend/app/main.py` wiring a real `OpenAILLMClient` and `ShowStore("snapshots")` for `uvicorn app.main:app`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_api.py`:

```python
from fastapi.testclient import TestClient

from app.api import create_app
from app.models import RoundConfig
from app.store import ShowStore

FIVE = ["strategist", "diplomat", "loyalist", "operator", "wildcard"]


class TalkativeClient:
    def complete_with_tools(self, system_prompt, user_prompt, tools):
        return [{"name": "speak_public", "arguments": {"text": "I am here."}}]

    def complete(self, system_prompt, user_prompt):
        return "A lively round."


def fast_config():
    return RoundConfig(
        action_budget=1, debounce_seconds=0.0, cooldown_seconds=0.0,
        quiescence_seconds=0.1, round_timeout_seconds=5.0, gm_review_every=100,
    )


def make_client(tmp_path):
    store = ShowStore(snapshot_dir=str(tmp_path))
    app = create_app(store, TalkativeClient(), fast_config())
    return TestClient(app), store


def create_show(client, **overrides):
    body = {"title": "Bhram", "agent_preset_ids": FIVE}
    body.update(overrides)
    return client.post("/shows", json=body)


def test_create_show_requires_exactly_five_agents(tmp_path):
    client, _ = make_client(tmp_path)
    response = create_show(client, agent_preset_ids=["strategist"])
    assert response.status_code == 400


def test_create_show_returns_running_show_with_five_contestants(tmp_path):
    client, _ = make_client(tmp_path)
    data = create_show(client).json()
    assert len(data["contestants"]) == 5
    assert data["status"] == "running"


def test_secret_connections_are_applied_symmetrically(tmp_path):
    client, _ = make_client(tmp_path)
    data = create_show(client, secret_connections=[
        {"agent_a": "strategist", "agent_b": "diplomat",
         "connection_note": "Former business partners."},
    ]).json()

    contestants = {c["id"]: c for c in data["contestants"]}
    assert contestants["strategist"]["connected_to"] == "diplomat"
    assert contestants["diplomat"]["connected_to"] == "strategist"
    assert contestants["diplomat"]["connection_note"] == "Former business partners."


def test_run_round_returns_narrative(tmp_path):
    client, _ = make_client(tmp_path)
    show_id = create_show(client).json()["id"]

    response = client.post(f"/shows/{show_id}/rounds")

    assert response.status_code == 200
    assert response.json() == {"round": 1, "narrative": "A lively round."}


def test_round_limit_is_enforced(tmp_path):
    client, _ = make_client(tmp_path)
    show_id = create_show(client, max_rounds=1).json()["id"]

    assert client.post(f"/shows/{show_id}/rounds").status_code == 200
    assert client.post(f"/shows/{show_id}/rounds").status_code == 409
    assert client.get(f"/shows/{show_id}").json()["status"] == "ended"


def test_kill_agent(tmp_path):
    client, _ = make_client(tmp_path)
    show_id = create_show(client).json()["id"]

    response = client.post(f"/shows/{show_id}/agents/strategist/kill")

    assert response.json()["status"] == "eliminated"


def test_release_event_marks_it_released(tmp_path):
    client, store = make_client(tmp_path)
    show_id = create_show(client).json()["id"]
    client.post(f"/shows/{show_id}/rounds")

    response = client.post(f"/shows/{show_id}/events/0/release")

    assert response.status_code == 200
    assert response.json()["released"] is True
    assert store.get(show_id).events[0].released is True


def test_release_missing_event_returns_404(tmp_path):
    client, _ = make_client(tmp_path)
    show_id = create_show(client).json()["id"]
    assert client.post(f"/shows/{show_id}/events/999/release").status_code == 404


def test_websocket_streams_events_during_a_round(tmp_path):
    client, _ = make_client(tmp_path)
    show_id = create_show(client).json()["id"]

    with client.websocket_connect(f"/ws/{show_id}") as websocket:
        client.post(f"/shows/{show_id}/rounds")
        first = websocket.receive_json()

    assert first["kind"] == "gm_announcement"
    assert first["seq"] == 0
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/test_api.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.api'`.

- [ ] **Step 3: Implement `backend/app/api.py`**

```python
import asyncio

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from .event_bus import EventBus
from .models import AgentStatus, RoundConfig, Show, ShowStatus
from .presets import (
    DEFAULT_GM_PROMPT, DEFAULT_RULES_TEXT, DEFAULT_SHOW_PROMPT, build_preset_agent,
)
from .supervisor import run_round


class CreateShowRequest(BaseModel):
    title: str
    show_prompt: str = DEFAULT_SHOW_PROMPT
    gm_prompt: str = DEFAULT_GM_PROMPT
    rules_text: str = DEFAULT_RULES_TEXT
    max_rounds: int = None
    secret_connections: list = []
    agent_preset_ids: list


def create_app(store, llm_client, config: RoundConfig = None) -> FastAPI:
    app = FastAPI()
    config = config or RoundConfig()
    buses = {}
    sockets = {}
    stop_events = {}

    def bus_for(show):
        if show.id not in buses:
            bus = EventBus(show)
            bus.add_listener(lambda event: _fan_out(show.id, event))
            buses[show.id] = bus
        return buses[show.id]

    def _fan_out(show_id, event):
        payload = event.to_dict()
        for websocket in list(sockets.get(show_id, [])):
            asyncio.create_task(_safe_send(show_id, websocket, payload))

    async def _safe_send(show_id, websocket, payload):
        try:
            await websocket.send_json(payload)
        except Exception:
            if websocket in sockets.get(show_id, []):
                sockets[show_id].remove(websocket)

    @app.post("/shows")
    def create_show(req: CreateShowRequest):
        if len(req.agent_preset_ids) != 5:
            raise HTTPException(400, "Must pick exactly 5 agents")
        show = Show(
            id=req.title.lower().replace(" ", "-"),
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
            agent_a.connected_to, agent_b.connected_to = agent_b.id, agent_a.id
            agent_a.connection_note = connection["connection_note"]
            agent_b.connection_note = connection["connection_note"]
        store.add(show)
        return show.to_dict()

    @app.get("/shows/{show_id}")
    def get_show(show_id: str):
        return store.get(show_id).to_dict()

    @app.post("/shows/{show_id}/rounds")
    async def start_round(show_id: str):
        show = store.get(show_id)
        if show.max_rounds is not None and show.current_round >= show.max_rounds:
            show.status = ShowStatus.ENDED
            raise HTTPException(409, "Show has reached its round limit")

        stop_event = asyncio.Event()
        stop_events[show_id] = stop_event
        try:
            narrative = await run_round(
                show, bus_for(show), llm_client, config, store, stop_event
            )
        finally:
            stop_events.pop(show_id, None)

        if show.max_rounds is not None and show.current_round >= show.max_rounds:
            show.status = ShowStatus.ENDED
        return {"round": show.current_round, "narrative": narrative}

    @app.post("/shows/{show_id}/stop")
    def stop_round(show_id: str):
        stop_event = stop_events.get(show_id)
        if stop_event is None:
            return {"stopped": False}
        stop_event.set()
        return {"stopped": True}

    @app.post("/shows/{show_id}/agents/{agent_id}/kill")
    def kill_agent(show_id: str, agent_id: str):
        agent = store.get(show_id).get_agent(agent_id)
        agent.status = AgentStatus.ELIMINATED
        return agent.to_dict()

    @app.post("/shows/{show_id}/events/{seq}/release")
    def release_event(show_id: str, seq: int):
        show = store.get(show_id)
        for event in show.events:
            if event.seq == seq:
                event.released = True
                return event.to_dict()
        raise HTTPException(404, "No event with that seq")

    @app.websocket("/ws/{show_id}")
    async def show_socket(websocket: WebSocket, show_id: str):
        await websocket.accept()
        sockets.setdefault(show_id, []).append(websocket)
        try:
            while True:
                await websocket.receive_text()
        except WebSocketDisconnect:
            if websocket in sockets.get(show_id, []):
                sockets[show_id].remove(websocket)

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
Expected: the whole backend suite passes, 67 tests total across all modules.

- [ ] **Step 5: Commit**

```bash
git add backend/app/api.py backend/app/main.py backend/tests/test_api.py
git commit -m "feat: add API routes, producer controls, and live event WebSocket"
```

---

### Task 12: Frontend scaffold and API client

**Files:**
- Create: `frontend/package.json`, `frontend/vite.config.js`, `frontend/src/api/client.js`, `frontend/src/presets.js`
- Test: `frontend/src/api/client.test.js`

**Interfaces:**
- Produces in `client.js`: `createShow(payload)`, `getShow(showId)`, `startRound(showId)`, `stopRound(showId)`, `killAgent(showId, agentId)`, `releaseEvent(showId, seq)`, and `openEventSocket(showId, onEvent) -> WebSocket`. All REST calls throw on non-2xx.
- Produces in `presets.js`: `PRESET_AGENTS` (8 `{id, name}` mirroring the backend pool), plus `DEFAULT_SHOW_PROMPT`, `DEFAULT_GM_PROMPT`, `DEFAULT_RULES_TEXT`.
- This is the only frontend module that calls `fetch` or constructs a `WebSocket`.

- [ ] **Step 1: Scaffold and write the failing test**

Create `frontend/package.json`:

```json
{
  "name": "bhram-frontend",
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
    "@testing-library/jest-dom": "^6.5.0",
    "@testing-library/react": "^16.0.1",
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
  test: { environment: "jsdom", globals: true, setupFiles: "./src/setupTests.js" },
});
```

Create `frontend/src/setupTests.js`:

```javascript
import "@testing-library/jest-dom";
```

Create `frontend/src/api/client.test.js`:

```javascript
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createShow, getShow, startRound, stopRound, killAgent, releaseEvent,
} from "./client";

beforeEach(() => {
  global.fetch = vi.fn();
});

function ok(data) {
  return Promise.resolve({ ok: true, json: () => Promise.resolve(data) });
}

describe("api client", () => {
  it("createShow posts to /shows", async () => {
    global.fetch.mockReturnValue(ok({ id: "bhram" }));
    const result = await createShow({ title: "Bhram", agent_preset_ids: [] });
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/shows"),
      expect.objectContaining({ method: "POST" })
    );
    expect(result).toEqual({ id: "bhram" });
  });

  it("getShow fetches the show", async () => {
    global.fetch.mockReturnValue(ok({ id: "bhram" }));
    await getShow("bhram");
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/shows/bhram")
    );
  });

  it("startRound and stopRound hit their routes", async () => {
    global.fetch.mockReturnValue(ok({ round: 1, narrative: "x" }));
    await startRound("bhram");
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/shows/bhram/rounds"),
      expect.objectContaining({ method: "POST" })
    );

    global.fetch.mockReturnValue(ok({ stopped: true }));
    await stopRound("bhram");
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/shows/bhram/stop"),
      expect.objectContaining({ method: "POST" })
    );
  });

  it("killAgent hits the kill route", async () => {
    global.fetch.mockReturnValue(ok({ status: "eliminated" }));
    await killAgent("bhram", "vikram");
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/shows/bhram/agents/vikram/kill"),
      expect.objectContaining({ method: "POST" })
    );
  });

  it("releaseEvent posts to the event release route", async () => {
    global.fetch.mockReturnValue(ok({ seq: 3, released: true }));
    const result = await releaseEvent("bhram", 3);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/shows/bhram/events/3/release"),
      expect.objectContaining({ method: "POST" })
    );
    expect(result.released).toBe(true);
  });

  it("throws when a response is not ok", async () => {
    global.fetch.mockReturnValue(
      Promise.resolve({ ok: false, json: () => Promise.resolve({ detail: "nope" }) })
    );
    await expect(getShow("missing")).rejects.toThrow("nope");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run from `frontend/`: `npm install && npm test`
Expected: FAIL — `src/api/client.js` does not exist.

- [ ] **Step 3: Implement `frontend/src/api/client.js` and `frontend/src/presets.js`**

```javascript
const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8000";

async function request(path, options) {
  const response = await fetch(`${API_BASE}${path}`, options);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.detail || `Request to ${path} failed`);
  }
  return response.json();
}

function post(path, body) {
  const options = { method: "POST" };
  if (body !== undefined) {
    options.headers = { "Content-Type": "application/json" };
    options.body = JSON.stringify(body);
  }
  return request(path, options);
}

export function createShow(payload) {
  return post("/shows", payload);
}

export function getShow(showId) {
  return request(`/shows/${showId}`);
}

export function startRound(showId) {
  return post(`/shows/${showId}/rounds`);
}

export function stopRound(showId) {
  return post(`/shows/${showId}/stop`);
}

export function killAgent(showId, agentId) {
  return post(`/shows/${showId}/agents/${agentId}/kill`);
}

export function releaseEvent(showId, seq) {
  return post(`/shows/${showId}/events/${seq}/release`);
}

export function openEventSocket(showId, onEvent) {
  const url = `${API_BASE.replace(/^http/, "ws")}/ws/${showId}`;
  const socket = new WebSocket(url);
  socket.onmessage = (message) => onEvent(JSON.parse(message.data));
  return socket;
}
```

Create `frontend/src/presets.js` (mirrors `backend/app/presets.py`, kept in sync by hand):

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
  "Five strangers live together in a house under constant observation. " +
  "They can speak to the whole house or privately to each other. Alliances " +
  "form and break. The Game Master watches everything and can warn or " +
  "remove anyone who breaks the house rules.";

export const DEFAULT_GM_PROMPT =
  "You are the Game Master of a reality show. You are fair but firm. You " +
  "enforce the house rules exactly as written and never play favorites. " +
  "Interject only when it matters: a rule was broken, or the house needs " +
  "direction. Explain every ruling in one or two sentences. End the round " +
  "when the drama has peaked or the conversation has run its course.";

export const DEFAULT_RULES_TEXT =
  "1. No agent may accuse another of an action without stating what " +
  "evidence they have.\n" +
  "2. Direct insults with no strategic content are not allowed.\n" +
  "3. No agent may claim the Game Master has given them a private instruction.";
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add frontend/package.json frontend/vite.config.js frontend/src/setupTests.js frontend/src/api/client.js frontend/src/api/client.test.js frontend/src/presets.js
git commit -m "feat: scaffold frontend and add API client with event socket"
```

---

### Task 13: Show Setup screen

**Files:**
- Create: `frontend/src/components/ShowSetup.jsx`
- Test: `frontend/src/components/ShowSetup.test.jsx`

**Interfaces:**
- Consumes `createShow` (Task 12), `PRESET_AGENTS` and the three default prompts (Task 12).
- Produces `ShowSetup({ onCreated })`. Submits `{title, show_prompt, gm_prompt, rules_text, max_rounds, agent_preset_ids}` then calls `onCreated(show)`. Submit is disabled unless exactly 5 agents are checked. Blank rounds field sends `null`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/ShowSetup.test.jsx`:

```javascript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import ShowSetup from "./ShowSetup";
import * as api from "../api/client";

const FIVE_NAMES = [
  "The Strategist", "The Diplomat", "The Loyalist", "The Operator", "The Wildcard",
];

beforeEach(() => {
  vi.restoreAllMocks();
});

function selectFive() {
  for (const name of FIVE_NAMES) {
    fireEvent.click(screen.getByLabelText(name));
  }
}

describe("ShowSetup", () => {
  it("disables submit until exactly five agents are selected", () => {
    render(<ShowSetup onCreated={() => {}} />);
    const submit = screen.getByRole("button", { name: /start show/i });
    expect(submit).toBeDisabled();

    selectFive();
    expect(submit).not.toBeDisabled();

    fireEvent.click(screen.getByLabelText("The Skeptic"));
    expect(submit).toBeDisabled();
  });

  it("submits prompts, rounds, and agents, then reports the created show", async () => {
    const spy = vi.spyOn(api, "createShow").mockResolvedValue({ id: "bhram" });
    const onCreated = vi.fn();

    render(<ShowSetup onCreated={onCreated} />);
    fireEvent.change(screen.getByLabelText(/show title/i), {
      target: { value: "Bhram" },
    });
    fireEvent.change(screen.getByLabelText(/number of rounds/i), {
      target: { value: "6" },
    });
    selectFive();
    fireEvent.click(screen.getByRole("button", { name: /start show/i }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith({ id: "bhram" }));
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Bhram",
        max_rounds: 6,
        agent_preset_ids: [
          "strategist", "diplomat", "loyalist", "operator", "wildcard",
        ],
      })
    );
  });

  it("sends null rounds when the field is left blank", async () => {
    const spy = vi.spyOn(api, "createShow").mockResolvedValue({ id: "bhram" });

    render(<ShowSetup onCreated={() => {}} />);
    selectFive();
    fireEvent.click(screen.getByRole("button", { name: /start show/i }));

    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ max_rounds: null }));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `src/components/ShowSetup.jsx` does not exist.

- [ ] **Step 3: Implement `frontend/src/components/ShowSetup.jsx`**

```javascript
import { useState } from "react";
import { createShow } from "../api/client";
import {
  PRESET_AGENTS, DEFAULT_SHOW_PROMPT, DEFAULT_GM_PROMPT, DEFAULT_RULES_TEXT,
} from "../presets";

export default function ShowSetup({ onCreated }) {
  const [title, setTitle] = useState("Bhram");
  const [showPrompt, setShowPrompt] = useState(DEFAULT_SHOW_PROMPT);
  const [gmPrompt, setGmPrompt] = useState(DEFAULT_GM_PROMPT);
  const [rulesText, setRulesText] = useState(DEFAULT_RULES_TEXT);
  const [maxRounds, setMaxRounds] = useState("");
  const [selectedIds, setSelectedIds] = useState([]);

  function toggleAgent(id) {
    setSelectedIds((current) =>
      current.includes(id)
        ? current.filter((existing) => existing !== id)
        : [...current, id]
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

      <label htmlFor="max-rounds">Number of rounds (blank for unlimited)</label>
      <input
        id="max-rounds"
        type="number"
        min="1"
        value={maxRounds}
        onChange={(e) => setMaxRounds(e.target.value)}
      />

      <label htmlFor="show-prompt">Show premise</label>
      <textarea
        id="show-prompt"
        value={showPrompt}
        onChange={(e) => setShowPrompt(e.target.value)}
      />

      <label htmlFor="gm-prompt">Game Master personality</label>
      <textarea
        id="gm-prompt"
        value={gmPrompt}
        onChange={(e) => setGmPrompt(e.target.value)}
      />

      <label htmlFor="rules-text">House rules</label>
      <textarea
        id="rules-text"
        value={rulesText}
        onChange={(e) => setRulesText(e.target.value)}
      />

      <fieldset>
        <legend>Pick exactly five housemates</legend>
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
Expected: 9 passed (6 client + 3 setup).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ShowSetup.jsx frontend/src/components/ShowSetup.test.jsx
git commit -m "feat: add show setup screen with editable prompts and agent picker"
```

---

### Task 14: Live Room and event feed

**Files:**
- Create: `frontend/src/components/EventFeed.jsx`, `frontend/src/components/LiveRoom.jsx`
- Test: `frontend/src/components/EventFeed.test.jsx`, `frontend/src/components/LiveRoom.test.jsx`

**Interfaces:**
- Produces `EventFeed({ showId, events, narratives, onEventReleased })` — two tabs. "Live feed" shows **every** event including unreleased private ones and confessions, each labelled, with a Reveal button on unreleased private events calling `releaseEvent(showId, seq)`. "Story" shows the per-round narratives in round order.
- Produces `LiveRoom({ show, onShowUpdated })` — roster with status and a kill control, plus Start round and Stop round buttons wired to `startRound`/`stopRound`.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/components/EventFeed.test.jsx`:

```javascript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import EventFeed from "./EventFeed";
import * as api from "../api/client";

const events = [
  { seq: 0, round: 1, sender_id: "game_master", text: "Round 1 begins.",
    kind: "gm_announcement", visibility: "public", recipients: [], released: false },
  { seq: 1, round: 1, sender_id: "vikram", text: "I trust no one.",
    kind: "agent_action", visibility: "public", recipients: [], released: false },
  { seq: 2, round: 1, sender_id: "simran", text: "Ally with me.",
    kind: "agent_action", visibility: "private", recipients: ["karan"], released: false },
  { seq: 3, round: 1, sender_id: "simran", text: "I am playing both sides.",
    kind: "confession", visibility: "private", recipients: [], released: false },
];

const narratives = { 1: "The house settled into an uneasy quiet." };

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("EventFeed", () => {
  it("live feed shows public, private, and confession events", () => {
    render(<EventFeed showId="s1" events={events} narratives={narratives}
                      onEventReleased={() => {}} />);
    expect(screen.getByText(/I trust no one\./)).toBeInTheDocument();
    expect(screen.getByText(/Ally with me\./)).toBeInTheDocument();
    expect(screen.getByText(/I am playing both sides\./)).toBeInTheDocument();
  });

  it("story tab shows narratives and hides raw events", () => {
    render(<EventFeed showId="s1" events={events} narratives={narratives}
                      onEventReleased={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /story/i }));

    expect(screen.getByText("The house settled into an uneasy quiet.")).toBeInTheDocument();
    expect(screen.queryByText(/I trust no one\./)).not.toBeInTheDocument();
  });

  it("reveal appears only on unreleased private events and calls the API", async () => {
    const spy = vi.spyOn(api, "releaseEvent").mockResolvedValue({ seq: 2, released: true });
    const onEventReleased = vi.fn();

    render(<EventFeed showId="s1" events={events} narratives={narratives}
                      onEventReleased={onEventReleased} />);

    const revealButtons = screen.getAllByRole("button", { name: /reveal/i });
    expect(revealButtons).toHaveLength(2);

    fireEvent.click(revealButtons[0]);
    await waitFor(() => expect(spy).toHaveBeenCalledWith("s1", 2));
    expect(onEventReleased).toHaveBeenCalledWith({ seq: 2, released: true });
  });
});
```

Create `frontend/src/components/LiveRoom.test.jsx`:

```javascript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import LiveRoom from "./LiveRoom";
import * as api from "../api/client";

const show = {
  id: "bhram",
  title: "Bhram",
  current_round: 0,
  contestants: [
    { id: "vikram", name: "Vikram", status: "active" },
    { id: "meera", name: "Meera", status: "warned" },
  ],
};

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("LiveRoom", () => {
  it("renders the roster with names and statuses", () => {
    render(<LiveRoom show={show} onShowUpdated={() => {}} />);
    expect(screen.getByText("Vikram")).toBeInTheDocument();
    expect(screen.getByText("active")).toBeInTheDocument();
    expect(screen.getByText("warned")).toBeInTheDocument();
  });

  it("start round calls the API and reports the result", async () => {
    const spy = vi.spyOn(api, "startRound").mockResolvedValue({ round: 1, narrative: "x" });
    const onShowUpdated = vi.fn();

    render(<LiveRoom show={show} onShowUpdated={onShowUpdated} />);
    fireEvent.click(screen.getByRole("button", { name: /start round/i }));

    await waitFor(() => expect(spy).toHaveBeenCalledWith("bhram"));
    expect(onShowUpdated).toHaveBeenCalled();
  });

  it("stop round calls the stop API", async () => {
    const spy = vi.spyOn(api, "stopRound").mockResolvedValue({ stopped: true });

    render(<LiveRoom show={show} onShowUpdated={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /stop round/i }));

    await waitFor(() => expect(spy).toHaveBeenCalledWith("bhram"));
  });

  it("kill calls killAgent for that contestant", async () => {
    const spy = vi.spyOn(api, "killAgent")
      .mockResolvedValue({ id: "vikram", status: "eliminated" });

    render(<LiveRoom show={show} onShowUpdated={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /kill vikram/i }));

    await waitFor(() => expect(spy).toHaveBeenCalledWith("bhram", "vikram"));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — neither component file exists.

- [ ] **Step 3: Implement both components**

Create `frontend/src/components/EventFeed.jsx`:

```javascript
import { useState } from "react";
import { releaseEvent } from "../api/client";

function label(event) {
  if (event.kind === "confession") return "[confession, viewers only]";
  if (event.kind === "gm_ruling") return "[game master ruling]";
  if (event.kind === "gm_announcement") return "[game master]";
  if (event.visibility === "private" && !event.released) return "[private, viewers only]";
  return "";
}

export default function EventFeed({ showId, events, narratives, onEventReleased }) {
  const [tab, setTab] = useState("live");

  async function handleReveal(seq) {
    const updated = await releaseEvent(showId, seq);
    onEventReleased(updated);
  }

  const rounds = Object.keys(narratives)
    .map(Number)
    .sort((a, b) => a - b);

  return (
    <div>
      <button onClick={() => setTab("live")}>Live feed</button>
      <button onClick={() => setTab("story")}>Story</button>

      {tab === "live" && (
        <ul>
          {events.map((event) => (
            <li key={event.seq}>
              {label(event)} {event.sender_id}: {event.text}
              {event.visibility === "private" && !event.released && (
                <button onClick={() => handleReveal(event.seq)}>Reveal</button>
              )}
            </li>
          ))}
        </ul>
      )}

      {tab === "story" && (
        <div>
          {rounds.map((round) => (
            <p key={round}>{narratives[round]}</p>
          ))}
        </div>
      )}
    </div>
  );
}
```

Create `frontend/src/components/LiveRoom.jsx`:

```javascript
import { startRound, stopRound, killAgent } from "../api/client";

export default function LiveRoom({ show, onShowUpdated }) {
  async function handleStart() {
    onShowUpdated(await startRound(show.id));
  }

  async function handleStop() {
    onShowUpdated(await stopRound(show.id));
  }

  async function handleKill(agentId) {
    onShowUpdated(await killAgent(show.id, agentId));
  }

  return (
    <div>
      <button onClick={handleStart}>Start round</button>
      <button onClick={handleStop}>Stop round</button>

      <ul>
        {show.contestants.map((agent) => (
          <li key={agent.id}>
            <span>{agent.name}</span>
            <span>{agent.status}</span>
            <button
              aria-label={`Kill ${agent.name}`}
              onClick={() => handleKill(agent.id)}
            >
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
Expected: 16 passed (6 client + 3 setup + 3 feed + 4 live room).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/EventFeed.jsx frontend/src/components/EventFeed.test.jsx frontend/src/components/LiveRoom.jsx frontend/src/components/LiveRoom.test.jsx
git commit -m "feat: add live room controls and omniscient event feed with story tab"
```

---

## Not in this plan

Deferred per spec §11, in priority order: the stage/phase system with auto-pause, per-agent-targeted producer notes injected mid-round, mid-show rule editing, the POV toggle in the viewer UI (the visibility model already supports it — only the UI affordance is missing, see `glass-house-mockup.html`), and the loyalty ledger.

Wiring `openEventSocket` into `LiveRoom` for true live streaming is also deferred: Task 11 broadcasts every event over the WebSocket already, and Task 14's feed renders whatever event array it is handed, so connecting them is additive rather than blocking. Until then the feed refreshes from `getShow` after each round.

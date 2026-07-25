# Chat Filters & Leak Feature Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add name/type filtering to the world-view chat sidebar, and a "leak" mechanism (manual button + autonomous agent tool) that reveals a private message or confession as a public announcement everyone — including agents — reacts to.

**Architecture:** Backend gains one shared `perform_leak` helper (in `event_bus.py`) used by both a new HTTP endpoint and a new agent tool, built on the existing `event.released` flag and `EventBus` visibility rules. Frontend gains two client-side filter dropdowns over the existing `chatLog` state, a small red "leak" speech kind, and a new confirmation-dialog component reused from the existing dark-modal pattern.

**Tech Stack:** Python (FastAPI, dataclasses) on the backend; React + Vitest/Testing Library on the frontend. No new dependencies.

## Global Constraints

- Never add emojis to any file (user's global CLAUDE.md instruction).
- Follow TDD: write the failing test before the implementation in every task.
- Reuse `event.released` for "this message is now public knowledge" — do not add a second boolean for the same concept.
- Every leak (manual or agent-driven) must go through the single `perform_leak` helper — no duplicated validation/text-building logic.

---

## Task 1: `EventKind.LEAK` and `leaked_from_seq` on the `Event` model

**Files:**
- Modify: `backend/app/models.py`
- Test: `backend/tests/test_models.py`

**Interfaces:**
- Produces: `EventKind.LEAK` enum member (value `"leak"`); `Event.leaked_from_seq: Optional[int] = None` field, included in `Event.to_dict()` under key `"leaked_from_seq"`.

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/test_models.py`:

```python
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_models.py::test_event_leak_fields_default_and_serialize -v`
Expected: FAIL — `AttributeError` or `TypeError` because `EventKind.LEAK` and `leaked_from_seq` don't exist yet.

- [ ] **Step 3: Write minimal implementation**

In `backend/app/models.py`, add the `Optional` import at the top:

```python
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional
```

Add `LEAK` to `EventKind`:

```python
class EventKind(str, Enum):
    AGENT_ACTION = "agent_action"
    CONFESSION = "confession"
    GM_RULING = "gm_ruling"
    GM_ANNOUNCEMENT = "gm_announcement"
    NARRATION = "narration"
    LEAK = "leak"
```

Add the field and serialize it in `Event`:

```python
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
    leaked_from_seq: Optional[int] = None

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
            "leaked_from_seq": self.leaked_from_seq,
        }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && python -m pytest tests/test_models.py -v`
Expected: PASS (all tests in the file, including the new one).

- [ ] **Step 5: Commit**

```bash
git add backend/app/models.py backend/tests/test_models.py
git commit -m "feat: add EventKind.LEAK and leaked_from_seq to Event"
```

---

## Task 2: `perform_leak` shared helper in `event_bus.py`

**Files:**
- Modify: `backend/app/event_bus.py`
- Test: `backend/tests/test_event_bus.py`

**Interfaces:**
- Consumes: `EventKind.LEAK`, `Event.leaked_from_seq` from Task 1; `Show.get_agent(agent_id) -> Agent` (existing, raises `KeyError` if missing); `Agent.name` (existing).
- Produces: `perform_leak(bus: EventBus, event: Event, leaking_sender_id: str) -> tuple[Event, Event]` — returns `(updated_original_event, new_leak_event)`. Raises `ValueError` if `event` isn't leakable (wrong kind, or already `released`).

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/test_event_bus.py` (the file already imports `EventBus`, `EventKind`, `Show`, `Visibility`, `GM_ID`, and `pytest`):

```python
from app.event_bus import EventBus, perform_leak
from app.models import Agent


def make_show_with_agents():
    agents = [
        Agent(id="vikram", name="Vikram", personality_prompt="p"),
        Agent(id="meera", name="Meera", personality_prompt="p"),
    ]
    return Show(id="s1", title="T", show_prompt="p", gm_prompt="g",
                rules_text="r", contestants=agents)


@pytest.mark.asyncio
async def test_perform_leak_reveals_a_private_message_gm_attributed():
    show = make_show_with_agents()
    bus = EventBus(show)
    original = bus.publish("vikram", "Ally with me.", visibility=Visibility.PRIVATE,
                            recipients=["meera"])

    updated, leak_event = perform_leak(bus, original, GM_ID)

    assert updated.released is True
    assert leak_event.kind == EventKind.LEAK
    assert leak_event.visibility == Visibility.PUBLIC
    assert leak_event.sender_id == GM_ID
    assert leak_event.leaked_from_seq == original.seq
    assert leak_event.text == 'It has been leaked that Vikram said "Ally with me." to Meera.'


@pytest.mark.asyncio
async def test_perform_leak_reveals_a_confession_self_attributed():
    show = make_show_with_agents()
    bus = EventBus(show)
    original = bus.publish("vikram", "I am bluffing.", kind=EventKind.CONFESSION,
                            visibility=Visibility.PRIVATE, recipients=[])

    updated, leak_event = perform_leak(bus, original, "vikram")

    assert updated.released is True
    assert leak_event.sender_id == "vikram"
    assert leak_event.text == 'It has been leaked that Vikram confessed: "I am bluffing."'


@pytest.mark.asyncio
async def test_perform_leak_rejects_an_already_leaked_event():
    show = make_show_with_agents()
    bus = EventBus(show)
    original = bus.publish("vikram", "Ally with me.", visibility=Visibility.PRIVATE,
                            recipients=["meera"])
    perform_leak(bus, original, GM_ID)

    with pytest.raises(ValueError):
        perform_leak(bus, original, GM_ID)


@pytest.mark.asyncio
async def test_perform_leak_rejects_a_public_event():
    show = make_show_with_agents()
    bus = EventBus(show)
    original = bus.publish("vikram", "Hello house.")

    with pytest.raises(ValueError):
        perform_leak(bus, original, GM_ID)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_event_bus.py -v`
Expected: FAIL — `ImportError: cannot import name 'perform_leak'`.

- [ ] **Step 3: Write minimal implementation**

In `backend/app/event_bus.py`, add this function after the `EventBus` class (imports `Event, EventKind, Visibility, GM_ID` are already present at the top of the file):

```python
def perform_leak(bus: "EventBus", event: Event, leaking_sender_id: str) -> tuple:
    """Reveal a private message or confession as a new public LEAK event.
    Marks the original event released so agent context and the narrator
    treat it as common knowledge from now on."""
    leakable = (
        (event.kind == EventKind.AGENT_ACTION and event.visibility == Visibility.PRIVATE)
        or event.kind == EventKind.CONFESSION
    )
    if not leakable:
        raise ValueError(f"Event {event.seq} is not leakable (kind={event.kind.value})")
    if event.released:
        raise ValueError(f"Event {event.seq} has already been leaked")

    sender_name = bus.show.get_agent(event.sender_id).name
    if event.kind == EventKind.CONFESSION:
        text = f'It has been leaked that {sender_name} confessed: "{event.text}"'
    else:
        recipient_name = bus.show.get_agent(event.recipients[0]).name
        text = f'It has been leaked that {sender_name} said "{event.text}" to {recipient_name}.'

    event.released = True
    leak_event = bus.publish(
        leaking_sender_id, text, kind=EventKind.LEAK, visibility=Visibility.PUBLIC,
    )
    leak_event.leaked_from_seq = event.seq
    return event, leak_event
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && python -m pytest tests/test_event_bus.py -v`
Expected: PASS (all tests in the file).

- [ ] **Step 5: Commit**

```bash
git add backend/app/event_bus.py backend/tests/test_event_bus.py
git commit -m "feat: add perform_leak helper shared by API and agent tool"
```

---

## Task 3: `leak_message` agent tool schema

**Files:**
- Modify: `backend/app/tools.py`
- Test: `backend/tests/test_tools.py`

**Interfaces:**
- Produces: `AGENT_TOOLS` gains a `leak_message` entry with required parameter `event_seq` (integer).

- [ ] **Step 1: Write the failing test**

Replace the existing `test_agent_tools_expose_the_four_actions` test in `backend/tests/test_tools.py` with:

```python
def test_agent_tools_expose_the_five_actions():
    assert tool_names(AGENT_TOOLS) == {
        "speak_public", "send_private", "confess", "stay_silent", "leak_message",
    }


def test_leak_message_requires_event_seq():
    schema = next(t for t in AGENT_TOOLS if t["function"]["name"] == "leak_message")
    required = schema["function"]["parameters"]["required"]
    assert set(required) == {"event_seq"}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_tools.py -v`
Expected: FAIL — `test_agent_tools_expose_the_five_actions` fails because `leak_message` is not yet in `AGENT_TOOLS`, and `test_leak_message_requires_event_seq` fails with `StopIteration`.

- [ ] **Step 3: Write minimal implementation**

In `backend/app/tools.py`, add a new entry to `AGENT_TOOLS`, after `confess` and before `stay_silent`:

```python
    _function(
        "leak_message",
        "Reveal a private message or confession you know about to the "
        "whole house. Use this if it fits your personality and goals — "
        "it will be publicly announced and everyone will react to it.",
        {
            "event_seq": {
                "type": "integer",
                "description": "The seq number of the private message or "
                "confession to leak, from your own knowledge so far.",
            },
        },
        ["event_seq"],
    ),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && python -m pytest tests/test_tools.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/tools.py backend/tests/test_tools.py
git commit -m "feat: add leak_message tool to AGENT_TOOLS"
```

---

## Task 4: Agent-driven leaking (seq-prefixed context + dispatch handling)

**Files:**
- Modify: `backend/app/agent_loop.py`
- Test: `backend/tests/test_agent_loop.py`

**Interfaces:**
- Consumes: `perform_leak(bus, event, leaking_sender_id)` from Task 2; `leak_message` tool from Task 3; `bus.can_see(event, subscriber_id) -> bool` (existing, in `event_bus.py`).
- Produces: `_format_event` prefixes leakable lines with `[seq N, ...]`; `dispatch_agent_calls` handles `leak_message` calls.

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/test_agent_loop.py` (file already imports `EventBus`, `EventKind`, `Visibility`, `dispatch_agent_calls`, `make_show`):

```python
def test_format_event_prefixes_leakable_lines_with_seq():
    show = make_show()
    bus = EventBus(show)
    vikram = show.get_agent("vikram")
    bus.publish("meera", "Not for Vikram.", visibility=Visibility.PRIVATE,
                recipients=["karan"])
    bus.publish("vikram", "I am bluffing.", kind=EventKind.CONFESSION,
                visibility=Visibility.PRIVATE, recipients=[])
    bus.publish("meera", "Ally?", visibility=Visibility.PRIVATE, recipients=["vikram"])

    _, user_prompt = build_agent_prompt(show, vikram, bus, fast_config())

    assert "[seq 2, your own private thought]" in user_prompt
    assert "[seq 3, PRIVATE from meera]" in user_prompt


def test_dispatch_leak_message_reveals_a_witnessed_private_message():
    show = make_show()
    bus = EventBus(show)
    vikram = show.get_agent("vikram")
    original = bus.publish("meera", "Ally?", visibility=Visibility.PRIVATE,
                            recipients=["vikram"])

    published = dispatch_agent_calls(bus, vikram, [
        {"name": "leak_message", "arguments": {"event_seq": original.seq}},
    ])

    assert published == 1
    assert original.released is True
    leak_events = [e for e in show.events if e.kind == EventKind.LEAK]
    assert len(leak_events) == 1
    assert leak_events[0].sender_id == "vikram"
    assert "Meera" in leak_events[0].text


def test_dispatch_leak_message_ignores_an_event_never_witnessed():
    show = make_show()
    bus = EventBus(show)
    vikram = show.get_agent("vikram")
    original = bus.publish("meera", "Not for Vikram.", visibility=Visibility.PRIVATE,
                            recipients=["karan"])

    published = dispatch_agent_calls(bus, vikram, [
        {"name": "leak_message", "arguments": {"event_seq": original.seq}},
    ])

    assert published == 0
    assert original.released is False
    assert [e for e in show.events if e.kind == EventKind.LEAK] == []


def test_dispatch_leak_message_ignores_an_already_leaked_event():
    show = make_show()
    bus = EventBus(show)
    vikram = show.get_agent("vikram")
    original = bus.publish("vikram", "Ally?", visibility=Visibility.PRIVATE,
                            recipients=["meera"])
    original.released = True

    published = dispatch_agent_calls(bus, vikram, [
        {"name": "leak_message", "arguments": {"event_seq": original.seq}},
    ])

    assert published == 0


def test_dispatch_leak_message_ignores_an_unknown_seq():
    show = make_show()
    bus = EventBus(show)
    vikram = show.get_agent("vikram")

    published = dispatch_agent_calls(bus, vikram, [
        {"name": "leak_message", "arguments": {"event_seq": 999}},
    ])

    assert published == 0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_agent_loop.py -v`
Expected: FAIL — the seq-prefix assertions fail against the current unprefixed format, and the `leak_message` dispatch tests fail because that branch doesn't exist yet (calls fall into the `else: continue` branch, so `published == 0` for the "reveals a witnessed" test too, which is wrong — it should be 1).

- [ ] **Step 3: Write minimal implementation**

In `backend/app/agent_loop.py`, add the import:

```python
from .event_bus import perform_leak
```

Replace `_format_event`:

```python
def _format_event(event, agent) -> str:
    if event.kind == EventKind.GM_RULING:
        return f"[GAME MASTER RULING] {event.text}"
    if event.kind == EventKind.GM_ANNOUNCEMENT:
        return f"[GAME MASTER] {event.text}"
    if event.kind == EventKind.LEAK:
        return f"[LEAKED] {event.text}"
    if event.kind == EventKind.CONFESSION:
        return f"[seq {event.seq}, your own private thought] {event.text}"
    if event.sender_id == agent.id:
        if event.visibility == Visibility.PRIVATE and not event.released:
            return f"[seq {event.seq}, you, privately to {event.recipients}] {event.text}"
        return f"[you] {event.text}"
    if event.visibility == Visibility.PRIVATE and not event.released:
        return f"[seq {event.seq}, PRIVATE from {event.sender_id}] {event.text}"
    return f"{event.sender_id}: {event.text}"
```

Replace `dispatch_agent_calls`:

```python
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
        elif name == "leak_message":
            target = _find_event(bus.show, arguments.get("event_seq"))
            if target is None or not bus.can_see(target, agent.id):
                continue
            try:
                perform_leak(bus, target, agent.id)
            except ValueError:
                continue
        else:
            continue
        published += 1
    return published


def _find_event(show, seq):
    for event in show.events:
        if event.seq == seq:
            return event
    return None
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && python -m pytest tests/test_agent_loop.py -v`
Expected: PASS (all tests in the file — check that the pre-existing tests, which only assert message-text substrings rather than exact bracket formatting, still pass unmodified).

- [ ] **Step 5: Commit**

```bash
git add backend/app/agent_loop.py backend/tests/test_agent_loop.py
git commit -m "feat: let agents autonomously leak witnessed private messages"
```

---

## Task 5: `POST /shows/{show_id}/events/{seq}/leak` endpoint

**Files:**
- Modify: `backend/app/api.py`
- Test: `backend/tests/test_api.py`

**Interfaces:**
- Consumes: `perform_leak(bus, event, leaking_sender_id)` from Task 2.
- Produces: `POST /shows/{show_id}/events/{seq}/leak` — 200 with updated original event dict on success, 404 if `seq` doesn't exist, 409 if not leakable.

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/test_api.py`. The file already imports `TestClient`, `create_app`, `RoundConfig`, `ShowStore`; add `Event`, `EventKind`, `Visibility` to a new import line:

```python
from app.models import Event, EventKind, Visibility
```

Add the tests:

```python
def test_leak_event_reveals_a_private_message(tmp_path):
    client, store = make_client(tmp_path)
    show_id = create_show(client).json()["id"]
    show = store.get(show_id)
    show.events.append(Event(
        seq=0, round=1, sender_id="creditor", text="Ally with me.",
        visibility=Visibility.PRIVATE, recipients=["wife"],
    ))

    response = client.post(f"/shows/{show_id}/events/0/leak")

    assert response.status_code == 200
    assert response.json()["released"] is True
    leak_events = [e for e in show.events if e.kind == EventKind.LEAK]
    assert len(leak_events) == 1
    assert leak_events[0].sender_id == "game_master"
    assert "leaked" in leak_events[0].text.lower()


def test_leak_missing_event_returns_404(tmp_path):
    client, _ = make_client(tmp_path)
    show_id = create_show(client).json()["id"]
    assert client.post(f"/shows/{show_id}/events/999/leak").status_code == 404


def test_leak_public_event_returns_409(tmp_path):
    client, store = make_client(tmp_path)
    show_id = create_show(client).json()["id"]
    show = store.get(show_id)
    show.events.append(Event(seq=0, round=1, sender_id="creditor", text="Hello house."))

    assert client.post(f"/shows/{show_id}/events/0/leak").status_code == 409


def test_leak_already_leaked_event_returns_409(tmp_path):
    client, store = make_client(tmp_path)
    show_id = create_show(client).json()["id"]
    show = store.get(show_id)
    show.events.append(Event(
        seq=0, round=1, sender_id="creditor", text="Ally with me.",
        visibility=Visibility.PRIVATE, recipients=["wife"],
    ))
    client.post(f"/shows/{show_id}/events/0/leak")

    assert client.post(f"/shows/{show_id}/events/0/leak").status_code == 409
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_api.py -v`
Expected: FAIL — 404 on all four new tests (no `/leak` route registered yet).

- [ ] **Step 3: Write minimal implementation**

In `backend/app/api.py`:

Add `GM_ID` to the models import:

```python
from .models import AgentStatus, RoundConfig, Show, ShowStatus, GM_ID
```

Add `perform_leak` to the event_bus import:

```python
from .event_bus import EventBus, perform_leak
```

Add a `ValueError` exception handler next to the existing `KeyError` one:

```python
    @app.exception_handler(ValueError)
    async def valueerror_exception_handler(request, exc):
        return JSONResponse(status_code=409, content={"detail": str(exc)})
```

Add the endpoint right after `release_event`:

```python
    @app.post("/shows/{show_id}/events/{seq}/leak")
    def leak_event(show_id: str, seq: int):
        show = store.get(show_id)
        bus = bus_for(show)
        for event in show.events:
            if event.seq == seq:
                updated, _ = perform_leak(bus, event, GM_ID)
                return updated.to_dict()
        raise HTTPException(404, "No event with that seq")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && python -m pytest tests/test_api.py -v`
Expected: PASS (all tests in the file).

- [ ] **Step 5: Run the full backend test suite**

Run: `cd backend && python -m pytest -q`
Expected: All tests pass (this confirms Tasks 1–5 compose correctly).

- [ ] **Step 6: Commit**

```bash
git add backend/app/api.py backend/tests/test_api.py
git commit -m "feat: add POST /shows/{id}/events/{seq}/leak endpoint"
```

---

## Task 6: `leak` speech kind in `speechStyles.js`

**Files:**
- Modify: `frontend/src/world/speechStyles.js`
- Test: `frontend/src/world/speechStyles.test.js`

**Interfaces:**
- Produces: `SPEECH_STYLES.leak` entry; `speechKindFromEvent({ kind: "leak" }) === "leak"`; `speechLabelFromEvent({ kind: "leak" }) === "LEAKED"`.

- [ ] **Step 1: Write the failing test**

In `frontend/src/world/speechStyles.test.js`, update the `speechKindFromEvent` describe block and the `SPEECH_STYLES` describe block:

```js
describe("speechKindFromEvent", () => {
  it("maps agent actions by visibility", () => {
    expect(speechKindFromEvent({ kind: "agent_action", visibility: "public" })).toBe("public");
    expect(speechKindFromEvent({ kind: "agent_action", visibility: "private" })).toBe("private");
  });

  it("maps confession, gm, narration, and leak kinds", () => {
    expect(speechKindFromEvent({ kind: "confession" })).toBe("confession");
    expect(speechKindFromEvent({ kind: "gm_ruling" })).toBe("gm");
    expect(speechKindFromEvent({ kind: "gm_announcement" })).toBe("gm");
    expect(speechKindFromEvent({ kind: "narration" })).toBe("narration");
    expect(speechKindFromEvent({ kind: "leak" })).toBe("leak");
  });
});
```

```js
describe("SPEECH_STYLES", () => {
  it("defines a complete palette for every speech kind", () => {
    for (const kind of ["public", "private", "confession", "gm", "narration", "leak"]) {
      const style = SPEECH_STYLES[kind];
      expect(style.label).toBeTruthy();
      expect(style.bubbleBg).toMatch(/^#/);
      expect(style.bubbleFg).toMatch(/^#/);
      expect(style.bubbleBorder).toMatch(/^#/);
      expect(style.tailFill).toBe(style.bubbleBg);
      expect(style.chatBg).toBeTruthy();
      expect(style.chatFg).toMatch(/^#/);
      expect(style.chatAccent).toMatch(/^#/);
    }
  });
});
```

Add a new test to the `speechLabelFromEvent` describe block:

```js
  it("uses LEAKED for leak events", () => {
    expect(speechLabelFromEvent({ kind: "leak" })).toBe("LEAKED");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/world/speechStyles.test.js`
Expected: FAIL — `speechKindFromEvent({ kind: "leak" })` currently falls through to `"public"`; `SPEECH_STYLES.leak` is `undefined`.

- [ ] **Step 3: Write minimal implementation**

In `frontend/src/world/speechStyles.js`:

Update the typedef comment:

```js
/** @typedef {'public' | 'private' | 'confession' | 'gm' | 'narration' | 'leak'} SpeechKind */
```

Add the `leak` entry to `SPEECH_STYLES` (after `narration`):

```js
  leak: {
    label: "LEAKED",
    bubbleBg: "#c0392b",
    bubbleFg: "#ffffff",
    bubbleBorder: "#7a2317",
    bubbleBorderStyle: "solid",
    tailFill: "#c0392b",
    chatBg: "#1a1a1e",
    chatFg: "#e8e8ec",
    chatAccent: "#e74c3c",
  },
```

Update `speechKindFromEvent` to check for leak first:

```js
export function speechKindFromEvent(event) {
  if (event.kind === "leak") return "leak";
  if (event.kind === "confession") return "confession";
  if (event.kind === "gm_ruling" || event.kind === "gm_announcement") return "gm";
  if (event.kind === "narration") return "narration";
  if (event.kind === "agent_action" && event.visibility === "private") return "private";
  if (event.kind === "agent_action" && event.visibility === "public") return "public";
  if (event.visibility === "private") return "private";
  return "public";
}
```

(No change needed to `speechLabelFromEvent` — it already falls back to `SPEECH_STYLES[kind].label`, which is now `"LEAKED"` for the `leak` kind.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/world/speechStyles.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/world/speechStyles.js frontend/src/world/speechStyles.test.js
git commit -m "feat: add red leak speech kind to SPEECH_STYLES"
```

---

## Task 7: `leakEvent` API client function

**Files:**
- Modify: `frontend/src/api/client.js`
- Test: `frontend/src/api/client.test.js`

**Interfaces:**
- Produces: `leakEvent(showId: string, seq: number) -> Promise<object>` — POSTs to `/shows/{showId}/events/{seq}/leak`, returns the parsed JSON body.

- [ ] **Step 1: Write the failing test**

In `frontend/src/api/client.test.js`, add `leakEvent` to the import list and add a test after `releaseEvent posts to the event release route`:

```js
import {
  createShow, getShow, startRound, stopRound, endShow, killAgent, releaseEvent, leakEvent,
} from "./client";
```

```js
  it("leakEvent posts to the event leak route", async () => {
    global.fetch.mockReturnValue(ok({ seq: 3, released: true }));
    const result = await leakEvent("sheesha-ghar", 3);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/shows/sheesha-ghar/events/3/leak"),
      expect.objectContaining({ method: "POST" })
    );
    expect(result.released).toBe(true);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/api/client.test.js`
Expected: FAIL — `leakEvent` is not exported from `./client`.

- [ ] **Step 3: Write minimal implementation**

In `frontend/src/api/client.js`, add after `releaseEvent`:

```js
export function leakEvent(showId, seq) {
  return post(`/shows/${showId}/events/${seq}/leak`);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/api/client.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/client.js frontend/src/api/client.test.js
git commit -m "feat: add leakEvent API client function"
```

---

## Task 8: `LeakConfirmDialog` component

**Files:**
- Create: `frontend/src/components/LeakConfirmDialog.jsx`
- Test: `frontend/src/components/LeakConfirmDialog.test.jsx`

**Interfaces:**
- Produces: `export default function LeakConfirmDialog({ text, error, pending, onConfirm, onCancel })` — a modal with `data-testid="leak-confirm-dialog"`, quoted text at `data-testid="leak-confirm-text"`, inline error (when `error` is truthy) at `data-testid="leak-confirm-error"`, a "Cancel" button calling `onCancel`, and a "Leak"/"Leaking…" button (disabled while `pending`) calling `onConfirm`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/LeakConfirmDialog.test.jsx`:

```jsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import LeakConfirmDialog from "./LeakConfirmDialog";

describe("LeakConfirmDialog", () => {
  it("shows the quoted text and fires confirm/cancel callbacks", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <LeakConfirmDialog
        text="Ally with me."
        error={null}
        pending={false}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    expect(screen.getByTestId("leak-confirm-text")).toHaveTextContent("Ally with me.");
    fireEvent.click(screen.getByRole("button", { name: /^leak$/i }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("disables confirm while pending and shows an inline error", () => {
    render(
      <LeakConfirmDialog
        text="Ally with me."
        error="Event has already been leaked"
        pending
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );

    expect(screen.getByRole("button", { name: /leaking/i })).toBeDisabled();
    expect(screen.getByTestId("leak-confirm-error")).toHaveTextContent(
      "Event has already been leaked",
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/LeakConfirmDialog.test.jsx`
Expected: FAIL — the module doesn't exist yet.

- [ ] **Step 3: Write minimal implementation**

Create `frontend/src/components/LeakConfirmDialog.jsx`:

```jsx
const PIXEL_FONT = '"Press Start 2P", "VT323", monospace';

const overlayStyle = {
  position: "fixed",
  inset: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "rgba(10, 10, 14, 0.72)",
  zIndex: 4,
  padding: "24px",
  boxSizing: "border-box",
};

const panelStyle = {
  width: "min(100%, 380px)",
  display: "flex",
  flexDirection: "column",
  gap: "14px",
  background: "#16161c",
  border: "2px solid #2a2a32",
  borderRadius: "6px",
  padding: "20px 18px",
  color: "#e8e8ec",
  fontFamily: '"IBM Plex Sans", "Segoe UI", system-ui, sans-serif',
  boxSizing: "border-box",
};

const titleStyle = {
  margin: 0,
  fontFamily: PIXEL_FONT,
  fontSize: "10px",
  lineHeight: 1.5,
  color: "#e74c3c",
  textAlign: "center",
};

const quoteStyle = {
  margin: 0,
  maxHeight: "140px",
  overflowY: "auto",
  fontSize: "14px",
  lineHeight: 1.5,
  color: "#d8d8de",
  fontStyle: "italic",
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  borderLeft: "3px solid #e74c3c",
  paddingLeft: "10px",
};

const errorStyle = {
  margin: 0,
  fontSize: "12px",
  color: "#e5788a",
};

const actionsStyle = {
  display: "flex",
  gap: "8px",
  justifyContent: "center",
};

const cancelButtonStyle = {
  fontFamily: PIXEL_FONT,
  fontSize: "8px",
  lineHeight: 1.4,
  padding: "10px 12px",
  borderWidth: "2px",
  borderStyle: "solid",
  borderColor: "#3a3a44",
  borderRadius: "4px",
  background: "#2a2a32",
  color: "#e8e8ec",
  cursor: "pointer",
};

const confirmButtonStyle = {
  ...cancelButtonStyle,
  background: "#c0392b",
  color: "#ffffff",
  borderColor: "#7a2317",
};

const disabledConfirmButtonStyle = {
  ...confirmButtonStyle,
  opacity: 0.45,
  cursor: "not-allowed",
};

export default function LeakConfirmDialog({ text, error, pending, onConfirm, onCancel }) {
  return (
    <div
      style={overlayStyle}
      data-testid="leak-confirm-dialog"
      role="dialog"
      aria-labelledby="leak-confirm-title"
    >
      <div style={panelStyle}>
        <h2 id="leak-confirm-title" style={titleStyle}>
          Leak this to the whole house?
        </h2>
        <p style={quoteStyle} data-testid="leak-confirm-text">
          &quot;{text}&quot;
        </p>
        {error && (
          <p style={errorStyle} role="alert" data-testid="leak-confirm-error">
            {error}
          </p>
        )}
        <div style={actionsStyle}>
          <button type="button" style={cancelButtonStyle} onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            style={pending ? disabledConfirmButtonStyle : confirmButtonStyle}
            disabled={pending}
            onClick={onConfirm}
          >
            {pending ? "Leaking…" : "Leak"}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/components/LeakConfirmDialog.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/LeakConfirmDialog.jsx frontend/src/components/LeakConfirmDialog.test.jsx
git commit -m "feat: add LeakConfirmDialog component"
```

---

## Task 9: Filters, Leak button, and LEAKED badge in `WorldView.jsx`

**Files:**
- Modify: `frontend/src/components/WorldView.jsx`
- Test: `frontend/src/components/WorldView.test.jsx`

**Interfaces:**
- Consumes: `leakEvent(showId, seq)` from Task 7; `LeakConfirmDialog` from Task 8; `speechKindFromEvent` (existing).
- Produces: chat sidebar has a name-filter `<select data-testid="chat-filter-name">` and a type-filter `<select data-testid="chat-filter-type">`; each private/confession, not-yet-`released` chat entry has a `<button data-testid="leak-button-{key}">Leak</button>`; each `released` private/confession entry shows a `<span data-testid="chat-leaked-badge-{key}">LEAKED</span>`.

- [ ] **Step 1: Write the failing test**

In `frontend/src/components/WorldView.test.jsx`:

Update the imports at the top:

```jsx
import { render, screen, waitFor, act, fireEvent, within } from "@testing-library/react";
```

```jsx
vi.mock("../api/client", () => ({
  openEventSocket: vi.fn(),
  leakEvent: vi.fn(),
}));
```

```jsx
import { openEventSocket, leakEvent } from "../api/client";
```

Add these tests inside the `describe("WorldView", ...)` block:

```jsx
  it("filters the chat log by sender name and by message type", async () => {
    const cast = [
      { id: "creditor", name: "Vikram", spriteKey: "slot-1", tileX: 1, tileY: 1 },
      { id: "wife", name: "Priya", spriteKey: "slot-2", tileX: 2, tileY: 1 },
    ];
    render(<WorldView showId="s1" characters={cast} />);
    await waitFor(() => expect(WorldEngine).toHaveBeenCalledTimes(1));
    const onEvent = openEventSocket.mock.calls[0][1];

    act(() => {
      onEvent({
        seq: 1, sender_id: "creditor", kind: "agent_action",
        visibility: "public", recipients: [], text: "Public from Vikram.",
      });
      onEvent({
        seq: 2, sender_id: "wife", kind: "agent_action",
        visibility: "private", recipients: ["creditor"], text: "Private from Priya.",
      });
    });

    expect(screen.getByTestId("chat-entry-seq-1")).toBeInTheDocument();
    expect(screen.getByTestId("chat-entry-seq-2")).toBeInTheDocument();

    fireEvent.change(screen.getByTestId("chat-filter-name"), { target: { value: "wife" } });
    expect(screen.queryByTestId("chat-entry-seq-1")).not.toBeInTheDocument();
    expect(screen.getByTestId("chat-entry-seq-2")).toBeInTheDocument();

    fireEvent.change(screen.getByTestId("chat-filter-name"), { target: { value: "all" } });
    fireEvent.change(screen.getByTestId("chat-filter-type"), { target: { value: "private" } });
    expect(screen.queryByTestId("chat-entry-seq-1")).not.toBeInTheDocument();
    expect(screen.getByTestId("chat-entry-seq-2")).toBeInTheDocument();
  });

  it("shows a Leak button only for private/confession entries not yet leaked", async () => {
    const cast = [{ id: "creditor", name: "Vikram", spriteKey: "slot-1", tileX: 1, tileY: 1 }];
    render(<WorldView showId="s1" characters={cast} />);
    await waitFor(() => expect(WorldEngine).toHaveBeenCalledTimes(1));
    const onEvent = openEventSocket.mock.calls[0][1];

    act(() => {
      onEvent({
        seq: 1, sender_id: "creditor", kind: "agent_action",
        visibility: "public", recipients: [], text: "Public.",
      });
      onEvent({
        seq: 2, sender_id: "creditor", kind: "agent_action",
        visibility: "private", recipients: ["creditor"], text: "Private.", released: false,
      });
      onEvent({
        seq: 3, sender_id: "creditor", kind: "confession",
        visibility: "private", recipients: [], text: "Confession.", released: false,
      });
      onEvent({
        seq: 4, sender_id: "creditor", kind: "agent_action",
        visibility: "private", recipients: ["creditor"], text: "Already leaked.", released: true,
      });
    });

    expect(screen.queryByTestId("leak-button-seq-1")).not.toBeInTheDocument();
    expect(screen.getByTestId("leak-button-seq-2")).toBeInTheDocument();
    expect(screen.getByTestId("leak-button-seq-3")).toBeInTheDocument();
    expect(screen.queryByTestId("leak-button-seq-4")).not.toBeInTheDocument();
    expect(screen.getByTestId("chat-leaked-badge-seq-4")).toBeInTheDocument();
  });

  it("leaks a message through the confirm dialog and flips its badge", async () => {
    const cast = [{ id: "creditor", name: "Vikram", spriteKey: "slot-1", tileX: 1, tileY: 1 }];
    leakEvent.mockResolvedValue({ seq: 2, released: true });
    render(<WorldView showId="s1" characters={cast} />);
    await waitFor(() => expect(WorldEngine).toHaveBeenCalledTimes(1));
    const onEvent = openEventSocket.mock.calls[0][1];

    act(() => {
      onEvent({
        seq: 2, sender_id: "creditor", kind: "agent_action",
        visibility: "private", recipients: ["creditor"], text: "Private.", released: false,
      });
    });

    fireEvent.click(screen.getByTestId("leak-button-seq-2"));
    const dialog = screen.getByTestId("leak-confirm-dialog");
    expect(dialog).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: /^leak$/i }));
      await Promise.resolve();
    });

    expect(leakEvent).toHaveBeenCalledWith("s1", 2);
    expect(screen.queryByTestId("leak-confirm-dialog")).not.toBeInTheDocument();
    expect(screen.getByTestId("chat-leaked-badge-seq-2")).toBeInTheDocument();
    expect(screen.queryByTestId("leak-button-seq-2")).not.toBeInTheDocument();
  });

  it("shows an inline error when leaking fails", async () => {
    const cast = [{ id: "creditor", name: "Vikram", spriteKey: "slot-1", tileX: 1, tileY: 1 }];
    leakEvent.mockRejectedValue(new Error("Event has already been leaked"));
    render(<WorldView showId="s1" characters={cast} />);
    await waitFor(() => expect(WorldEngine).toHaveBeenCalledTimes(1));
    const onEvent = openEventSocket.mock.calls[0][1];

    act(() => {
      onEvent({
        seq: 2, sender_id: "creditor", kind: "agent_action",
        visibility: "private", recipients: ["creditor"], text: "Private.", released: false,
      });
    });

    fireEvent.click(screen.getByTestId("leak-button-seq-2"));
    const dialog = screen.getByTestId("leak-confirm-dialog");

    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: /^leak$/i }));
      await Promise.resolve();
    });

    expect(screen.getByTestId("leak-confirm-error")).toHaveTextContent(
      "Event has already been leaked",
    );
    expect(screen.getByTestId("leak-confirm-dialog")).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/WorldView.test.jsx`
Expected: FAIL — no `chat-filter-name`/`chat-filter-type` selects, no `leak-button-*`, no `chat-leaked-badge-*`, no `leak-confirm-dialog` exist yet.

- [ ] **Step 3: Write minimal implementation**

In `frontend/src/components/WorldView.jsx`:

Update the top imports:

```jsx
import { openEventSocket, leakEvent } from "../api/client";
import LeakConfirmDialog from "./LeakConfirmDialog";
```

Add new style constants near `chatEmptyStyle`:

```jsx
const chatFiltersStyle = {
  display: "flex",
  gap: "8px",
  padding: "10px 14px",
  borderBottom: "1px solid #2a2a32",
  background: "rgba(0, 0, 0, 0.14)",
};

const chatFilterSelectStyle = {
  flex: 1,
  minWidth: 0,
  background: "#1a1a1e",
  color: "#e8e8ec",
  border: "1px solid #2a2a32",
  borderRadius: "4px",
  padding: "5px 6px",
  fontSize: "12px",
  fontFamily: '"IBM Plex Sans", "Segoe UI", system-ui, sans-serif',
};

const leakedBadgeStyle = {
  color: "#e74c3c",
  fontSize: "9px",
  fontWeight: 700,
  letterSpacing: "0.04em",
  border: "1px solid #e74c3c",
  borderRadius: "999px",
  padding: "1px 6px",
};

const leakButtonStyle = {
  marginLeft: "auto",
  fontSize: "10px",
  padding: "2px 8px",
  background: "#c0392b",
  color: "#ffffff",
  border: "1px solid #7a2317",
  borderRadius: "4px",
  cursor: "pointer",
};

const TYPE_FILTER_OPTIONS = [
  { value: "all", label: "All types" },
  { value: "public", label: "Public" },
  { value: "private", label: "Private" },
  { value: "confession", label: "Confession" },
  { value: "gm", label: "GM" },
  { value: "narration", label: "Narration" },
  { value: "leak", label: "Leak" },
];
```

Inside the `WorldView` component, add new state (near the existing `chatLog` state):

```jsx
  const [nameFilter, setNameFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [pendingLeak, setPendingLeak] = useState(null);
  const [leaking, setLeaking] = useState(false);
  const [leakError, setLeakError] = useState(null);
```

Add derived values and handlers just before the `if (loadError)` guard:

```jsx
  const nameOptions = useMemo(() => {
    const seen = new Map();
    for (const event of chatLog) {
      const id = event.sender_id || "";
      if (!seen.has(id)) seen.set(id, chatSenderName(id, charactersById));
    }
    return [...seen.entries()];
  }, [chatLog, charactersById]);

  const filteredChatLog = chatLog.filter((event) => {
    if (nameFilter !== "all" && (event.sender_id || "") !== nameFilter) return false;
    if (typeFilter !== "all" && speechKindFromEvent(event) !== typeFilter) return false;
    return true;
  });

  function handleLeakClick(event) {
    setLeakError(null);
    setPendingLeak({ seq: event.seq, text: event.text });
  }

  function handleCancelLeak() {
    setPendingLeak(null);
    setLeakError(null);
  }

  async function handleConfirmLeak() {
    if (!pendingLeak) return;
    setLeaking(true);
    setLeakError(null);
    try {
      const updated = await leakEvent(showId, pendingLeak.seq);
      setChatLog((prev) => prev.map((event) => (
        event.seq === updated.seq ? { ...event, released: updated.released } : event
      )));
      setPendingLeak(null);
    } catch (error) {
      setLeakError(error.message || "Failed to leak message");
    } finally {
      setLeaking(false);
    }
  }
```

Add the filter dropdowns right after the `chatHeaderStyle` div:

```jsx
        <div style={chatHeaderStyle}>Full chat</div>
        <div style={chatFiltersStyle} data-testid="chat-filters">
          <select
            aria-label="Filter by name"
            data-testid="chat-filter-name"
            value={nameFilter}
            onChange={(e) => setNameFilter(e.target.value)}
            style={chatFilterSelectStyle}
          >
            <option value="all">All names</option>
            {nameOptions.map(([id, name]) => (
              <option key={id} value={id}>{name}</option>
            ))}
          </select>
          <select
            aria-label="Filter by type"
            data-testid="chat-filter-type"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            style={chatFilterSelectStyle}
          >
            {TYPE_FILTER_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
```

Replace the empty/list conditional to account for filters:

```jsx
        {chatLog.length === 0 ? (
          <p style={chatEmptyStyle}>
            The house is quiet. Show yet to start — stay tuned.
          </p>
        ) : filteredChatLog.length === 0 ? (
          <p style={chatEmptyStyle} data-testid="chat-filter-empty">
            No messages match these filters.
          </p>
        ) : (
          <ul style={chatListStyle}>
            {filteredChatLog.map((event, index) => {
              const senderColor = colorForSender(event.sender_id, characterIds);
              const speechKind = speechKindFromEvent(event);
              const card = chatCardStyles(senderColor, speechKind);
              const to = recipientNames(event, charactersById);
              const key = event.seq != null ? `seq-${event.seq}` : `idx-${index}`;
              const isLeakable = speechKind === "private" || speechKind === "confession";
              const canLeak = isLeakable && !event.released;
              return (
                <li
                  key={key}
                  data-testid={`chat-entry-${key}`}
                  data-speech-kind={speechKind}
                  data-sender={event.sender_id || ""}
                  data-sender-color={senderColor}
                  data-kind={event.kind || ""}
                  data-visibility={event.visibility || ""}
                  style={{ ...card.container, flexShrink: 0 }}
                >
                  <div style={card.header}>
                    <span style={card.sender}>
                      {chatSenderName(event.sender_id, charactersById)}
                    </span>
                    <span
                      data-testid={`chat-kind-${key}`}
                      style={card.typeBadge}
                    >
                      {speechLabelFromEvent(event)}
                    </span>
                    {isLeakable && event.released && (
                      <span data-testid={`chat-leaked-badge-${key}`} style={leakedBadgeStyle}>
                        LEAKED
                      </span>
                    )}
                    {to && (
                      <span style={card.recipient}>
                        → {to}
                      </span>
                    )}
                    {canLeak && (
                      <button
                        type="button"
                        data-testid={`leak-button-${key}`}
                        style={leakButtonStyle}
                        onClick={() => handleLeakClick(event)}
                      >
                        Leak
                      </button>
                    )}
                  </div>
                  <div
                    data-testid={`chat-text-${key}`}
                    style={card.body}
                  >
                    {event.text ?? ""}
                  </div>
                </li>
              );
            })}
            <li ref={chatEndRef} aria-hidden="true" style={{ height: 0, padding: 0, margin: 0 }} />
          </ul>
        )}
```

Finally, render the dialog as the last child of the root `<div style={shellStyle} ...>`, right after the closing `</aside>` tag:

```jsx
      </aside>
      {pendingLeak && (
        <LeakConfirmDialog
          text={pendingLeak.text}
          error={leakError}
          pending={leaking}
          onConfirm={handleConfirmLeak}
          onCancel={handleCancelLeak}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/components/WorldView.test.jsx`
Expected: PASS (all tests in the file, including the pre-existing ones).

- [ ] **Step 5: Run the full frontend test suite**

Run: `cd frontend && npm test`
Expected: All tests pass across every file (confirms Tasks 6–9 compose correctly with the rest of the app).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/WorldView.jsx frontend/src/components/WorldView.test.jsx
git commit -m "feat: add chat filters, leak button, and leaked badge to WorldView"
```

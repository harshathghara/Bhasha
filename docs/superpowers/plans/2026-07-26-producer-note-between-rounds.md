# Producer Note Between Rounds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After each round, let the producer optionally enter free text that is published as a public event visible to all contestants and the GM before the next round runs.

**Architecture:** Extend `POST /shows/{id}/rounds` with an optional `producer_note` body. `run_round` publishes a public `producer_note` event (sender `producer`) before the GM kickoff announcement when the note is non-empty after trim. Agents and GM format it as `[Producer note] …` via existing context rebuild. Frontend adds an optional textarea on `RoundEndModal` and passes the value through `startRound`.

**Tech Stack:** FastAPI, pytest/pytest-asyncio, React + Vite, Vitest + Testing Library.

## Global Constraints

- Note is optional; empty/whitespace/omitted must not publish an event.
- Shared with all contestants and the GM (public visibility).
- Free text only — no type selector or expiry field.
- Publish before the round kickoff announcement so it appears earlier in context.
- If round start is rejected (409 at max rounds), do not publish a note.
- Tests must not make real network/LLM calls; use existing fake clients and fast `RoundConfig`.

---

## File Structure

| File | Responsibility |
|---|---|
| `backend/app/models.py` | `PRODUCER_ID`, `EventKind.PRODUCER_NOTE` |
| `backend/app/supervisor.py` | Optional `producer_note` on `run_round`; publish before kickoff |
| `backend/app/api.py` | `StartRoundRequest` body; pass note into `run_round` |
| `backend/app/agent_loop.py` | Format `[Producer note]` in `_format_event` |
| `backend/app/gm_loop.py` | Format `[Producer note]` in `build_gm_prompt` |
| `frontend/src/api/client.js` | `startRound(showId, { producer_note }?)` |
| `frontend/src/components/RoundEndModal.jsx` | Optional textarea; pass note to `onStartNext` |
| `frontend/src/pages/WorldPage.jsx` | Wire note from modal into `startRound` |

---

### Task 1: Model + prompt labels

**Files:**
- Modify: `backend/app/models.py`
- Modify: `backend/app/agent_loop.py` (`_format_event`)
- Modify: `backend/app/gm_loop.py` (`build_gm_prompt`)
- Test: `backend/tests/test_agent_loop.py`, `backend/tests/test_gm_loop.py`

**Interfaces:**
- Produces: `PRODUCER_ID = "producer"`; `EventKind.PRODUCER_NOTE = "producer_note"`
- Produces: agent/GM lines formatted as `[Producer note] {text}`

- [ ] **Step 1: Write failing tests**

In `backend/tests/test_agent_loop.py`:

```python
def test_build_agent_prompt_labels_producer_notes():
    show = make_show()
    bus = EventBus(show)
    show.current_round = 1
    bus.publish(
        "producer",
        "Push the cash angle harder.",
        kind=EventKind.PRODUCER_NOTE,
    )
    agent = show.get_agent("vikram")
    _, user_prompt = build_agent_prompt(show, agent, bus, fast_config())
    assert "[Producer note] Push the cash angle harder." in user_prompt
```

In `backend/tests/test_gm_loop.py` (adapt to existing helpers):

```python
def test_build_gm_prompt_labels_producer_notes():
    show = make_show()  # use whatever helper exists in this file
    event = Event(
        seq=0, round=1, sender_id="producer",
        text="A letter arrives accusing Karan.",
        kind=EventKind.PRODUCER_NOTE,
    )
    _, user_prompt = build_gm_prompt(show, [event])
    assert "[Producer note] A letter arrives accusing Karan." in user_prompt
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && python -m pytest tests/test_agent_loop.py::test_build_agent_prompt_labels_producer_notes tests/test_gm_loop.py::test_build_gm_prompt_labels_producer_notes -v`

Expected: FAIL (`PRODUCER_NOTE` missing and/or label missing)

- [ ] **Step 3: Minimal implementation**

In `models.py` next to `GM_ID`:

```python
PRODUCER_ID = "producer"
```

Add to `EventKind`:

```python
PRODUCER_NOTE = "producer_note"
```

In `agent_loop._format_event`, before other kind checks (or after GM kinds):

```python
if event.kind == EventKind.PRODUCER_NOTE:
    return f"[Producer note] {event.text}"
```

In `gm_loop.build_gm_prompt` loop, before confession/private branches:

```python
if event.kind == EventKind.PRODUCER_NOTE:
    lines.append(f"[Producer note] {event.text}")
    continue
```

- [ ] **Step 4: Run tests to verify they pass**

Run: same pytest command as Step 2  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/models.py backend/app/agent_loop.py backend/app/gm_loop.py backend/tests/test_agent_loop.py backend/tests/test_gm_loop.py
git commit -m "feat: label producer notes in agent and GM prompts"
```

---

### Task 2: Supervisor publishes note before kickoff

**Files:**
- Modify: `backend/app/supervisor.py` (`run_round`)
- Test: `backend/tests/test_supervisor.py`

**Interfaces:**
- Consumes: `EventKind.PRODUCER_NOTE`, `PRODUCER_ID`
- Produces: `async def run_round(..., producer_note: str | None = None) -> str`
- Behavior: after `current_round += 1`, if `producer_note` strips to non-empty, `bus.publish(PRODUCER_ID, trimmed, kind=EventKind.PRODUCER_NOTE)` **before** the GM kickoff announce

- [ ] **Step 1: Write failing tests**

```python
@pytest.mark.asyncio
async def test_run_round_publishes_producer_note_before_kickoff():
    show = make_show()
    bus = EventBus(show)

    await asyncio.wait_for(
        run_round(
            show, bus, SilentClient(), fast_config(),
            producer_note="  Focus on the letter.  ",
        ),
        timeout=10,
    )

    assert show.events[0].kind == EventKind.PRODUCER_NOTE
    assert show.events[0].sender_id == "producer"
    assert show.events[0].text == "Focus on the letter."
    assert show.events[0].visibility.value == "public"
    assert show.events[1].kind == EventKind.GM_ANNOUNCEMENT


@pytest.mark.asyncio
async def test_run_round_skips_empty_producer_note():
    show = make_show()
    bus = EventBus(show)

    await asyncio.wait_for(
        run_round(show, bus, SilentClient(), fast_config(), producer_note="   "),
        timeout=10,
    )

    assert show.events[0].kind == EventKind.GM_ANNOUNCEMENT
    assert all(e.kind != EventKind.PRODUCER_NOTE for e in show.events)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && python -m pytest tests/test_supervisor.py::test_run_round_publishes_producer_note_before_kickoff tests/test_supervisor.py::test_run_round_skips_empty_producer_note -v`

Expected: FAIL (`producer_note` unexpected kwarg)

- [ ] **Step 3: Minimal implementation**

Update `run_round` signature and publish block:

```python
from .models import EventKind, GM_ID, PRODUCER_ID

async def run_round(show, bus, llm_client, config, store=None,
                    stop_event=None, producer_note=None) -> str:
    show.current_round += 1
    # ... existing budget reset + task spawn ...

    await asyncio.sleep(0)

    if producer_note and producer_note.strip():
        bus.publish(
            PRODUCER_ID,
            producer_note.strip(),
            kind=EventKind.PRODUCER_NOTE,
        )

    bus.publish(
        GM_ID,
        f"Round {show.current_round} begins. The house is open.",
        kind=EventKind.GM_ANNOUNCEMENT,
    )
    # ... rest unchanged ...
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && python -m pytest tests/test_supervisor.py -v`  
Expected: PASS (including existing kickoff test when no note)

- [ ] **Step 5: Commit**

```bash
git add backend/app/supervisor.py backend/tests/test_supervisor.py
git commit -m "feat: publish optional producer note before round kickoff"
```

---

### Task 3: API accepts optional `producer_note`

**Files:**
- Modify: `backend/app/api.py`
- Test: `backend/tests/test_api.py`

**Interfaces:**
- Produces: `class StartRoundRequest(BaseModel): producer_note: Optional[str] = None`
- Produces: `start_round(show_id, req: StartRoundRequest = StartRoundRequest())` passes `req.producer_note` into `run_round`
- 409 path unchanged and runs before `run_round` (no note published)

- [ ] **Step 1: Write failing tests**

```python
def test_start_round_with_producer_note_publishes_event(tmp_path):
    client, store = make_client(tmp_path)
    show_id = create_show(client).json()["id"]

    response = client.post(
        f"/shows/{show_id}/rounds",
        json={"producer_note": "Push the cash angle."},
    )

    assert response.status_code == 200
    events = store.get(show_id).events
    note_events = [e for e in events if e.kind.value == "producer_note"]
    assert len(note_events) == 1
    assert note_events[0].text == "Push the cash angle."
    assert note_events[0].sender_id == "producer"


def test_start_round_without_body_publishes_no_producer_note(tmp_path):
    client, store = make_client(tmp_path)
    show_id = create_show(client).json()["id"]

    assert client.post(f"/shows/{show_id}/rounds").status_code == 200
    assert all(e.kind.value != "producer_note" for e in store.get(show_id).events)


def test_round_limit_rejects_before_publishing_producer_note(tmp_path):
    client, store = make_client(tmp_path)
    show_id = create_show(client, max_rounds=1).json()["id"]
    assert client.post(f"/shows/{show_id}/rounds").status_code == 200

    response = client.post(
        f"/shows/{show_id}/rounds",
        json={"producer_note": "Should not appear."},
    )
    assert response.status_code == 409
    assert all(
        e.kind.value != "producer_note" or e.text != "Should not appear."
        for e in store.get(show_id).events
    )
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && python -m pytest tests/test_api.py::test_start_round_with_producer_note_publishes_event tests/test_api.py::test_start_round_without_body_publishes_no_producer_note tests/test_api.py::test_round_limit_rejects_before_publishing_producer_note -v`

Expected: FAIL (note not published / body ignored)

- [ ] **Step 3: Minimal implementation**

```python
class StartRoundRequest(BaseModel):
    producer_note: Optional[str] = None


@app.post("/shows/{show_id}/rounds")
async def start_round(show_id: str, req: StartRoundRequest = StartRoundRequest()):
    show = store.get(show_id)
    if show.max_rounds is not None and show.current_round >= show.max_rounds:
        show.status = ShowStatus.ENDED
        raise HTTPException(409, "Show has reached its round limit")

    stop_event = asyncio.Event()
    stop_events[show_id] = stop_event
    try:
        narrative = await run_round(
            show, bus_for(show), llm_client, config, store, stop_event,
            producer_note=req.producer_note,
        )
    finally:
        stop_events.pop(show_id, None)
    # ... unchanged end status / return ...
```

Note: FastAPI may require `Body` default carefully — `StartRoundRequest = StartRoundRequest()` allows empty POST body to keep existing clients working. If empty body fails validation, use `req: StartRoundRequest = None` and coerce to empty model.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && python -m pytest tests/test_api.py -v`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/api.py backend/tests/test_api.py
git commit -m "feat: accept optional producer_note on start round API"
```

---

### Task 4: Frontend client + RoundEndModal

**Files:**
- Modify: `frontend/src/api/client.js`
- Modify: `frontend/src/api/client.test.js`
- Modify: `frontend/src/components/RoundEndModal.jsx`
- Modify: `frontend/src/components/RoundEndModal.test.jsx`
- Modify: `frontend/src/pages/WorldPage.jsx`
- Modify: `frontend/src/pages/WorldPage.test.jsx` (only if assertions need updating for `startRound` args)

**Interfaces:**
- Produces: `startRound(showId, { producer_note } = {})` — omit body when no note; when note present, `POST` JSON `{ producer_note }`
- Produces: `RoundEndModal` calls `onStartNext(noteText)` where `noteText` is trimmed string or `""`
- Produces: `WorldPage.runRound(producerNote)` passes note into `startRound`

- [ ] **Step 1: Write failing tests**

`client.test.js`:

```javascript
it("startRound sends producer_note when provided", async () => {
  global.fetch.mockReturnValue(ok({ round: 1, narrative: "x" }));
  await startRound("bhram", { producer_note: "Focus on the letter." });
  expect(global.fetch).toHaveBeenCalledWith(
    expect.stringContaining("/shows/bhram/rounds"),
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ producer_note: "Focus on the letter." }),
    }),
  );
});
```

`RoundEndModal.test.jsx`:

```javascript
it("passes optional producer note to onStartNext", () => {
  const onStartNext = vi.fn();
  render(
    <RoundEndModal
      round={1}
      recap="Recap."
      narratives={{ 1: "Recap." }}
      storyOpen={false}
      showOver={false}
      starting={false}
      onStartNext={onStartNext}
      onToggleStory={() => {}}
    />,
  );

  fireEvent.change(screen.getByTestId("producer-note-input"), {
    target: { value: "  Soft hint: trust nobody.  " },
  });
  fireEvent.click(screen.getByRole("button", { name: /start next round/i }));

  expect(onStartNext).toHaveBeenCalledWith("Soft hint: trust nobody.");
});

it("starts next round with empty note when field left blank", () => {
  const onStartNext = vi.fn();
  render(
    <RoundEndModal
      round={1}
      recap="Recap."
      narratives={{ 1: "Recap." }}
      storyOpen={false}
      showOver={false}
      starting={false}
      onStartNext={onStartNext}
      onToggleStory={() => {}}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: /start next round/i }));
  expect(onStartNext).toHaveBeenCalledWith("");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npm test -- --run src/api/client.test.js src/components/RoundEndModal.test.jsx`

Expected: FAIL

- [ ] **Step 3: Minimal implementation**

`client.js`:

```javascript
export function startRound(showId, { producer_note } = {}) {
  const trimmed = typeof producer_note === "string" ? producer_note.trim() : "";
  if (trimmed) {
    return post(`/shows/${showId}/rounds`, { producer_note: trimmed });
  }
  return post(`/shows/${showId}/rounds`);
}
```

`RoundEndModal.jsx`: add local state + textarea between story panel and actions; on button click call `onStartNext(note.trim())`. Placeholder: `Optional note for all agents and the GM…`. `data-testid="producer-note-input"`.

`WorldPage.jsx`:

```javascript
async function runRound(producerNote = "") {
  // ... existing setup ...
  const result = await startRound(
    show.id,
    producerNote ? { producer_note: producerNote } : {},
  );
  // ... rest unchanged ...
}
```

Keep the top-left **Start round** button as `onClick={() => runRound()}` (no note).

Update existing `RoundEndModal` tests that click start next: they should still pass if `onStartNext` is called with `""`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npm test -- --run src/api/client.test.js src/components/RoundEndModal.test.jsx src/pages/WorldPage.test.jsx`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/client.js frontend/src/api/client.test.js frontend/src/components/RoundEndModal.jsx frontend/src/components/RoundEndModal.test.jsx frontend/src/pages/WorldPage.jsx frontend/src/pages/WorldPage.test.jsx
git commit -m "feat: optional producer note on round-end modal"
```

---

### Task 5: Full verification

- [ ] **Step 1: Run backend suite**

Run: `cd backend && python -m pytest -v`  
Expected: PASS

- [ ] **Step 2: Run frontend suite**

Run: `cd frontend && npm test -- --run`  
Expected: PASS

- [ ] **Step 3: Manual smoke (optional)**  
Start a show, finish round 1, enter a note, start round 2, confirm the note appears in the live event feed and agents react.

---

## Spec coverage checklist

| Spec requirement | Task |
|---|---|
| Optional textarea on RoundEndModal | Task 4 |
| Empty = unchanged behavior | Tasks 2–4 |
| `POST /rounds` optional `producer_note` | Task 3 |
| Public event, sender `producer`, kind `producer_note` | Tasks 1–2 |
| Publish before kickoff | Task 2 |
| `[Producer note]` label for agents + GM | Task 1 |
| 409 does not publish note | Task 3 |
| Clear field after start (local state resets when modal remounts / controlled clear) | Task 4 — clear textarea after successful handoff or remount when modal closes |

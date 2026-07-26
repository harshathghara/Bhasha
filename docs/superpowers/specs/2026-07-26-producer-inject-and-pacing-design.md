# Producer Inject & Conversation Pacing — Design Notes

Branch: `story-optimization`  
Status: design notes (pacing deferred for implementation choice; inject recommendation below)  
Related: `2026-07-25-sheesha-ghar-design.md` (harness), deferred “producer notes mid-round” in §11

## 1. Goal

Two producer-experience gaps:

1. **Mid-round inject** — during a live round, the producer drops a clue / announcement that every housemate can see and that shapes the *next* turns.
2. **Pacing** — the event log currently feels too fast for a “real conversation”; slow it without breaking the concurrent-agent architecture.

---

## 2. Best idea for mid-round inject (recommendation)

### Recommendation: **live public event on the EventBus** (no pause required)

While a round is running, expose something like:

`POST /shows/{show_id}/events`  
body: `{ "text": "…clue or announcement…" }`

Implementation sketch (fits existing harness):

1. Resolve the show’s live `EventBus` (same bus the round already uses).
2. `bus.publish(sender_id="producer", text=…, kind=GM_ANNOUNCEMENT or a dedicated PRODUCER_NOTE kind, visibility=PUBLIC)`.
3. Event is appended to `show.events`, fanned out to **every agent inbox**, streamed on the WebSocket, and included in `visible_events_for` on each agent’s **next** think.

Why this is the best fit for *this* app:

| Requirement | Why live public publish wins |
|---|---|
| “Publicly accessible” | `Visibility.PUBLIC` — all agents + viewers see it |
| “Used in next conversation” | Agent context is rebuilt from the event log every wake; no new memory system |
| “Conversation moves forward” | Inbox wake → agents react; round does not need to end |
| Harness standards | Single visibility choke point stays `EventBus`; no auth/DB; prompts stay in Show/presets |
| Minimal surface | One route + thin UI (textbox + “Inject”); reuse WebSocket feed |

### What not to do (for v1)

- **Do not** only mutate `show_prompt` mid-round — agents already built turns from the log; a prompt edit is invisible until something republishes context, and it is not a visible “beat” in the feed.
- **Do not** require full **Stop round** — stop ends the round via `stop_event`; that is not “inject and continue.”
- **Pause → inject → Resume** is a valid *upgrade*, but heavier (freeze agent/GM loops, resume safely). Prefer live inject first; add pause later if the producer needs a hard freeze.

### Optional later: pause / resume

- `POST .../pause` — set a `paused` flag loops check before LLM calls.  
- Inject while paused.  
- `POST .../resume` — clear flag.  

Same inject path underneath; pause only controls *when* agents may think.

### UI sketch

In Live Room (while round is active): text field + **Inject clue** button → calls the new API → line appears in the live feed as `[producer]` / `[game master]` style announcement → housemates respond on subsequent turns.

### Existing producer controls (for context)

| Control | Behavior today |
|---|---|
| Stop round | Ends the round (not a pause) |
| Kill agent | Eliminates a contestant |
| Reveal | Sets `released=True` on a private event so all agents can see it later |
| Inject | **Missing** — this note recommends adding it |

---

## 3. Pacing — problem and strategies (for later implementation)

### Why it feels fast

Five agent tasks run **concurrently**. After each act they only wait `RoundConfig.cooldown_seconds` (default **3.0**), with `debounce_seconds` **0.8** before thinking. Parallel wakes → bursty log, not turn-taking dialogue.

### Strategies (standard options)

Recorded here for a future task; pick one or combine when implementing.

#### A. Raise cooldown (backend, simplest)

- Increase `cooldown_seconds` (e.g. **8–12**) on the live `RoundConfig` used by `create_app` / `main`.
- Pros: one knobs, no architecture change.  
- Cons: still concurrent; occasional double-speak.

#### B. Frontend paced reveal (UX)

- Buffer WebSocket events and show them with a short delay or typewriter effect.
- Pros: readable for the audience even if the model is fast; no change to agent logic.  
- Cons: backend still “thinks” in bursts; UI lag vs true state.

#### C. Speech lock / turn-taking (most “TV conversation”)

- Only one public `speak_public` at a time (mutex / token); others wait or only send private/confess.
- Pros: closest to real dialogue pacing.  
- Cons: more code; changes concurrency assumptions in loops/supervisor.

#### D. Recommended combo for this project

**A + B:** longer backend cooldown **and** a small feed delay so the producer can read lines. Add **C** only if still too chaotic after tuning.

### Config note

`RoundConfig` already has:

- `debounce_seconds` — batch inbox before an LLM call  
- `cooldown_seconds` — gap after an agent acts  

Tests should keep zeroed/fast values; only the live app defaults (or a producer-facing “pace” setting) should slow down.

---

## 4. Out of scope for this note

- Implementing inject or pacing (follow-up plan/tasks).
- Encoding a true killer or scripting who reacts to a clue.
- Persisting injected clues across server restarts (still in-memory show log only).

## 5. Success criteria (when implemented)

**Inject:** Producer can drop text mid-round; it appears in the live feed; at least one subsequent agent turn clearly references it; round continues without stop/restart.

**Pacing:** Producer can follow the feed as speech-like turns without feeling like five people dump walls of text in one second (exact timing tunable).

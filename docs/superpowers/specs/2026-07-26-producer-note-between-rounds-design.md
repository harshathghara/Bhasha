# Producer Note Between Rounds — Design Spec

Optional free-text input after each round ends. Shared with all contestant agents
and the Game Master so they can act on it in the following round. The user may
skip it entirely.

## 1. Goal

Between rounds, the producer (user) can type any guidance — out-of-world
direction, in-world beat, soft hint, short-term or long-term — as free text.
That text is injected once into the shared public event log so every agent and
the GM see it via normal context rebuild. Empty input leaves current behavior
unchanged.

Out of scope: typed note categories, mid-round injection, per-agent targeted
notes, persistent re-injection outside the event log, editing past notes.

## 2. UX

Surface: `RoundEndModal` (after “Round N ended”, before action buttons).

- Optional multiline textarea
- Placeholder: e.g. “Optional note for all agents and the GM…”
- **Start next round** always enabled (when the show is not over); note is not required
- On start: if the field has non-whitespace text, send it with the round request;
  then clear the field for the next between-round pause
- Whitespace-only is treated as no note

## 3. API

Extend `POST /shows/{show_id}/rounds` with an optional JSON body:

```json
{ "producer_note": "string" }
```

- Field omitted, `null`, `""`, or whitespace-only → no producer event; round
  starts as today
- Non-empty after trim → publish one public producer note event, then run the
  round
- Existing error cases unchanged (`409` at max rounds / ended show); if the
  request is rejected, no note is published

Frontend: `startRound(showId, { producer_note })` passes the optional string
from the modal.

## 4. Event model & visibility

Publish before the normal round kickoff announcement (so the note appears in
context ahead of “Round N begins…”):

| Field | Value |
|---|---|
| `sender_id` | `"producer"` |
| `kind` | `producer_note` (new `EventKind`) |
| `visibility` | `public` |
| `text` | trimmed user string |
| `round` | the round about to run (`current_round` after increment) |

Public visibility → all contestants and the GM receive it via the bus / visible
event log. Live WebSocket clients see it in the feed like other public events.

## 5. Prompt formatting

Agents and GM already rebuild context from visible events. Add a clear label:

- Agents (`_format_event`): `[Producer note] {text}`
- GM prompt builder: same label so the note is not mistaken for contestant
  speech or a GM announcement
- Narrator may include it in the recap like other public events (no special
  exclusion)

Agents/GM interpret duration and intent from the free text itself (no separate
expiry or type field).

## 6. Round lifecycle (updated)

```
Round ends → RoundEndModal
  → optional producer_note in textarea
  → Start next round
  → POST /rounds { producer_note? }
  → if note: bus.publish(producer, text, kind=producer_note, public)
  → existing run_round kickoff + agent/GM loops
```

## 7. Testing

- Frontend: modal starts next round with and without text; empty/whitespace does
  not send a meaningful note
- API: non-empty body publishes one `producer_note` event before kickoff; empty
  body publishes none
- Prompt formatting: agent/GM context includes `[Producer note] …` for that event
- Rejection path: at max rounds, no event is added

## 8. Files likely touched

- `backend/app/models.py` — `EventKind.PRODUCER_NOTE`
- `backend/app/api.py` — optional body on start round
- `backend/app/supervisor.py` — publish note before kickoff
- `backend/app/agent_loop.py` / `gm_loop.py` — format label
- `frontend/src/api/client.js` — pass optional note
- `frontend/src/components/RoundEndModal.jsx` — textarea
- `frontend/src/pages/WorldPage.jsx` — wire note into `runRound`
- Matching unit/integration tests

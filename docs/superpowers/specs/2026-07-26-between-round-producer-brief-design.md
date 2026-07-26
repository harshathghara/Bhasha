# Between-Round Producer Brief — Design

Branch: `story-optimization`  
Status: implemented  
Related: mid-round inject (`2026-07-26-producer-inject-and-pacing-design.md`), harness round lifecycle (`2026-07-25-bhram-design.md` §5–6)

## 1. Goal

After a round ends, the producer currently must click **Start round** with no place to steer the next act. Add an optional text field on that control so the producer can drop a **public brief / clue** that every housemate sees at the opening of the new round.

This is complementary to mid-round inject:

| | Mid-round inject | Between-round brief |
|---|---|---|
| When | Round is live | Before / as next round starts |
| Purpose | Interrupt and redirect ongoing talk | Open the next act with a beat |
| API today | `POST /shows/{id}/events` | Extend `POST /shows/{id}/rounds` |

## 2. Behavior (option B — approved)

On **Start round**:

1. Run the round as today (increment round, reset budgets, spawn loops).
2. Always publish the default kickoff:  
   `Round N begins. The house is open.` (`GM_ANNOUNCEMENT`).
3. If the producer supplied non-empty text, **immediately after** that kickoff publish a public `PRODUCER_NOTE` with that text (same kind as mid-round inject).
4. Agents wake on both events; both appear in the live feed and in agent context for that round.

Empty / omitted text → current behavior (kickoff only). Text is never required.

## 3. API

Extend:

`POST /shows/{show_id}/rounds`  
optional body: `{ "opening_brief": "…" }`

- Missing body or missing / blank `opening_brief` → kickoff only.
- Non-empty after strip → publish `producer_note` after kickoff, tagged to the **new** `current_round`.
- Response unchanged: `{ "round": int, "narrative": str }` (still awaits full round completion).

Do **not** invent a separate “between rounds” bus; reuse `EventBus.publish` + `PRODUCER_ID` / `EventKind.PRODUCER_NOTE`.

## 4. Supervisor change

`run_round(..., opening_brief: str | None = None)`:

After the existing kickoff `bus.publish(...)`, if `opening_brief` is non-empty:

```text
bus.publish(PRODUCER_ID, opening_brief, kind=EventKind.PRODUCER_NOTE)
```

Order must be: kickoff first, brief second. Both before the end-watcher wait continues (they publish while tasks are already running, same as today’s kickoff).

## 5. UI

In LiveRoom, next to **Start round**:

- Label: e.g. “Round brief (optional)”
- Textarea / input for producer text
- **Start round** submits: `startRound(showId, { opening_brief })` then clears the field on success
- Mid-round **Inject clue** stays as a separate control for live drops

Suggested copy: producer can write things like “Police found a second set of footprints by the back door.”

## 6. Out of scope

- Auto-starting the next round without a click
- Replacing the default kickoff line (option A rejected)
- Pausing between rounds for multi-step editing
- Changing round end conditions or `max_rounds` behavior

## 7. Acceptance

1. Start round with empty brief → only `"Round N begins…"` opens the round.
2. Start round with text → kickoff then `[producer clue]` with that text; agents’ subsequent turns can reference it; feed shows both.
3. Brief is attributed to the new round’s `round` number, not the previous one.
4. Existing mid-round inject still works during the live round.

# Chat Filters & Leak Feature — Design

## Goal

Add two capabilities to the world-view chat sidebar:

1. **Filtering** the chat log by sender name and by message type.
2. **Leaking** a private message or confession into the public chat as a
   new announcement, visible to everyone and to every agent's context —
   so agents can react to and change their behavior around it.

Leaking can happen two ways:
- **Manually**, via a "Leak" button the human viewer clicks in the sidebar
  (attributed to the Game Master).
- **Autonomously**, when an agent decides — based on its personality and
  goals — to reveal something it witnessed (attributed to that agent by
  name).

## Backend

### Data model (`app/models.py`)

- Add `EventKind.LEAK = "leak"`.
- Add `leaked_from_seq: Optional[int] = None` to `Event`, included in
  `to_dict()`. Set only on LEAK events, pointing back at the event that
  was revealed.
- No new flag for "this message was leaked" — reuse the existing
  `event.released` boolean, which already means "this private event is
  now known to everyone" and is already respected by `narrator.py` and
  `agent_loop._format_event`.

### Shared leak logic

A single helper, `perform_leak(bus, event, leaking_sender_id)`, added to
`app/event_bus.py` (it needs `bus.publish` and `bus.show`, so it lives
next to `EventBus` rather than in a new module):

1. Validates the event is leakable: kind is `AGENT_ACTION` with
   `visibility == PRIVATE`, or kind is `CONFESSION`; and
   `not event.released`. Raises `ValueError` with a descriptive message
   otherwise — the API layer already has a `KeyError` → 404 exception
   handler from prior work, so a matching `ValueError` → 409 handler is
   added the same way in `app/api.py`, and `dispatch_agent_calls` simply
   catches `ValueError` and ignores the call (same silent-skip pattern
   as any other invalid tool call).
2. Sets `event.released = True`.
3. Builds announcement text:
   - Private message (has a recipient):
     `It has been leaked that {sender_name} said "{text}" to {recipient_name}.`
   - Confession (no recipient):
     `It has been leaked that {sender_name} confessed: "{text}"`
4. Publishes a new event via `bus.publish(leaking_sender_id, announcement_text, kind=EventKind.LEAK, visibility=Visibility.PUBLIC)`, with `leaked_from_seq=event.seq` attached to the created `Event`.
5. Returns the (now-updated) original event and the new leak event.

Both the HTTP endpoint and the agent tool dispatch call this one helper,
so the wording and the `released`-flip logic exist in exactly one place.

### HTTP endpoint (`app/api.py`)

`POST /shows/{show_id}/events/{seq}/leak`

- 404 if no event with that `seq` exists (same pattern as the existing
  `/release` endpoint).
- 409 if the event isn't leakable per the validation above (already
  released, or a public/GM/narration/leak kind) — surfaced via the new
  `ValueError` → 409 exception handler.
- On success, calls `perform_leak(bus, event, GM_ID)` and returns
  the **updated original event's dict** (the new LEAK event itself
  reaches all viewers/agents through the existing websocket fan-out —
  there is only one viewer in this app, so no extra sync mechanism is
  needed beyond that).

### Agent tool (`app/tools.py`, `app/agent_loop.py`)

New tool in `AGENT_TOOLS`:

```
leak_message(event_seq: integer)
"Reveal a private message or confession you know about to the whole
house. Use this if it fits your personality and goals — it will be
publicly announced and everyone will react to it."
```

`_format_event` gains seq-number prefixes, but **only** for lines the
agent could legally leak (private messages and confessions it can see),
so the model has concrete IDs to reference without cluttering public
lines:

```
[seq 7, PRIVATE from priya] I don't trust the lawyer.
[seq 9, your own private thought] I've been hiding money from him for months.
```

`dispatch_agent_calls` handles `leak_message`:

- Look up the event by `event_seq` in `show.events`; if missing, ignore
  the call (same defensive pattern already used for unrecognized calls).
- Independently re-validate (never trust the model's own claim of having
  seen it): `bus.can_see(event, agent.id)` must be true (this already
  encodes "agent was the sender, a recipient, or GM" — exactly the "only
  witnessed messages" rule), checked *before* calling `perform_leak`.
- Call `perform_leak(bus, event, agent.id)` inside a `try/except
  ValueError: continue` — so the announcement reads "It has been leaked
  that Priya said...", i.e. self-attributed, not GM-attributed, and any
  remaining validation failure (already released, wrong kind) is ignored
  silently, consistent with how other bad tool calls are already handled
  in this function.

GM does **not** get a `leak_message` tool of its own — the GM attribution
only happens for human-triggered leaks via the HTTP endpoint.

## Frontend

### Filters (`components/WorldView.jsx`)

Two dropdowns at the top of the chat pane, below the "Full chat" header:

- **Name filter:** `All` plus every unique sender seen in `chatLog` so
  far (via `chatSenderName`).
- **Type filter:** `All`, `Public`, `Private`, `Confession`, `GM`,
  `Narration`, `Leak` (extends `speechKindFromEvent`/`SPEECH_STYLES`
  with the new `leak` kind).

Both filters combine with AND logic as a pure client-side render filter
over the existing `chatLog` state — no events are discarded, so
resetting to "All"/"All" always restores full history. Two new
`useState` values (`nameFilter`, `typeFilter`) in `WorldView`, styled to
match the existing dark `chatHeaderStyle` look.

### Leak button & confirmation (`components/WorldView.jsx`)

- A small red-accented "Leak" button renders in a chat entry's header row
  when `speechKind` is `private` or `confession` **and** the event is not
  already `released`.
- Clicking opens a confirmation modal (visually consistent with the
  existing dark `RoundEndModal`): shows the quoted message text and
  "Leak this to the whole house?" with Cancel/Confirm.
- Confirm calls a new `leakEvent(showId, seq)` in `api/client.js` (POSTs
  to `/shows/{id}/events/{seq}/leak`). On success, the matching entry in
  local `chatLog` state is updated to `released: true` (flips its badge)
  and the dialog closes. The new public LEAK announcement arrives
  separately through the already-open websocket, so it is not appended
  manually (avoiding duplication).
- On failure (e.g. a 409 because someone/something else already leaked
  it first), show the error inline in the dialog; user can cancel.

### New "leak" speech-kind styling (`world/speechStyles.js`)

- World-view bubble (above a character's head): solid red background
  (`#c0392b`), white text, darker red border (`#7a2317`) — a bold,
  alarm-style bubble distinct from the muted dark GM bubble, since a
  leak is meant to read as a dramatic, disruptive event.
- Sidebar type badge/accent: red (`#e74c3c`) against the existing dark
  `chatBg`/`chatFg` shared by every other kind.
- Label: `"LEAKED"`.

### Marking the original message

Once an entry's `released` flag flips to `true`, its existing type badge
(e.g. "PRIVATE") gains an additional small red "LEAKED" tag next to it —
so the retroactive reveal is visible on the original bubble itself, not
only on the new announcement bubble.

## Testing plan

**Backend:**
- `test_models.py` — `EventKind.LEAK` exists; `leaked_from_seq`
  serializes.
- `test_tools.py` — `leak_message` present in `AGENT_TOOLS` with correct
  schema.
- `test_agent_loop.py` — seq-prefixed formatting for leakable lines only;
  `dispatch_agent_calls` performs a valid leak and silently ignores an
  invalid one (wrong agent, already released, bad seq, non-leakable
  kind).
- `test_api.py` — `POST /leak` happy path (private and confession
  wording variants, `released` flips, LEAK event published with
  `leaked_from_seq`), 404 for missing seq, 409 for non-leakable/
  already-leaked events.

**Frontend:**
- `speechStyles.test.js` — `leak` kind added to `SPEECH_STYLES` and to
  `speechKindFromEvent`/`speechLabelFromEvent`.
- `api/client.test.js` — `leakEvent(showId, seq)` posts to the correct
  URL.
- `WorldView.test.jsx` — name/type filters narrow `chatLog` correctly
  (including combined AND behavior); Leak button appears only for
  private/confession entries that aren't yet released; confirm dialog
  calls `leakEvent` and flips the local badge on success; error path
  shows inline message; leak announcement bubble renders with the new
  `leak` styling when a LEAK-kind event arrives over the socket.

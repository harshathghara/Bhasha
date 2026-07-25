# World Character Interactions — Design Spec

**Goal:** Connect the World UI (built in the gamified-world-ui plan) to the real Sheesha Ghar backend, so the 5 wandering characters are the show's actual contestants, and their public speech, private messages, and confessions play out visually — walking toward each other, facing each other, and showing chat bubbles — instead of just idle random wandering.

**Context:** The World UI currently renders 5 hardcoded placeholder characters that wander a single room with no connection to any real show. The backend already streams every event over a WebSocket (`GET /ws/{show_id}`), unfiltered, as `{seq, round, sender_id, text, kind, visibility, recipients, released, timestamp}`. The frontend already has an `openEventSocket(showId, onEvent)` client (built in an earlier task, never wired to any component) and a `ShowSetup` component that creates a show via the API but whose result currently goes nowhere (`App.jsx` renders `WorldPage` directly with no real show).

## Non-goals (this phase)

- Any UI for releasing private events/confessions to the World view (that's `EventFeed`'s job elsewhere in the app).
- GM ejecting/warning agents changing a character's appearance or removing them from the room (agent status changes aren't visualized here beyond normal wandering continuing or not — out of scope, could be a fast follow).
- Multi-room navigation, or any interactivity beyond automatic event-driven behavior (no click-to-inspect).
- Sound/audio.

## Architecture

The animation loop stays fully inside `WorldEngine` (plain JS, outside React), extended with a **per-character state machine** rather than a parallel system:

- `mode`: `"wander"` (today's random-walk behavior, unchanged) → `"walking-to-interact"` (following a computed path) → `"interacting"` (frozen, facing a direction, bubble visible) → back to `"wander"`.
- `queue`: a small FIFO of pending interaction commands for that character. A private message is pushed onto **both** participants' queues at once, and only starts once it's at the front of *both* queues simultaneously — so neither side starts walking until the other is actually free to receive it. Public speech and confessions push onto only the sender's queue.
- Characters not involved in the current head-of-queue command keep wandering exactly as today; this is strictly per-character state, not global.

Two alternatives were considered and rejected: a separate "interaction director" mutating characters from outside the engine (two systems touching the same state risks desync bugs), and modeling the walk-together as a floating DOM/CSS overlay decoupled from the tile grid (creates two disagreeing representations of where a character is). Keeping it inside the existing engine loop keeps one source of truth.

## Components

### `world/pathfinding.js` (new, pure)

BFS from a start tile to the nearest tile adjacent to a target tile (4-neighborhood), over the existing `MAP`/`isWalkable` grid. Returns a path (ordered list of tiles) or `null` if unreachable. The room is small and mostly open, so plain BFS (no heuristic) is sufficient. Target tiles are captured **once**, as a snapshot when an interaction starts — not continuously re-chased — so two characters converging can't end up chasing each other indefinitely.

### `world/eventMapping.js` (new, pure)

Translates a raw backend `Event` (`{sender_id, recipients, text, kind, visibility}`) into an interaction command: `{ kind: "public" | "private" | "confession" | "gm", senderId, recipientId?, text }`. `AGENT_ACTION` + `visibility: "public"` → `public`; `AGENT_ACTION` + `visibility: "private"` → `private` (recipient is `recipients[0]`); `CONFESSION` → `confession`; `GM_RULING`/`GM_ANNOUNCEMENT` → `gm`; `NARRATION` → `null` (ignored — already shown in `EventFeed`'s Story tab).

### `world/interactions.js` (new, pure)

The per-character queue/state-machine transition logic: given the current characters (with their `mode`/`queue`) and "now", decides which characters should transition `wander` → `walking-to-interact` (computing a path via `pathfinding.js`) or `walking-to-interact` → `interacting` (path complete, face the other participant) or `interacting` → `wander` (bubble duration elapsed, dequeue). Kept separate from `engine.js` so it's unit-testable against plain character-state fixtures, matching the existing `movement.js` pattern.

### `world/engine.js` (modified)

`update()` now checks each character's `mode`/`queue` via `interactions.js` before falling back to the existing random-wander logic (which continues to run unchanged for `wander`-mode characters with an empty queue). Gains a `handleEvent(command)` method that enqueues an incoming interaction command onto the relevant character(s), and an `onFrame(snapshot)` constructor option — called at the end of every `draw()` — that reports plain-data character positions, current `mode`, and active bubble text/icon, plus any active GM banner. This mirrors the existing `rng`/`requestFrame` constructor-option pattern already used for testability.

### `components/WorldView.jsx` (modified)

Takes a `showId` prop in addition to `characters`. On mount: builds/starts the engine as today, and separately opens `openEventSocket(showId, onEvent)`, piping each event through `eventMapping.js` into `engine.handleEvent(...)`. Subscribes to the engine's `onFrame` callback, throttled to ~10fps (bubbles don't need 60fps — only the canvas movement does), and renders positioned HTML/CSS overlay `<div>`s for bubbles (white background, black text, ~80-char truncated message + a Unicode icon: 💬 public, 🔒 private, 💭 confession) and a bottom-docked banner div for GM events. Both sockets and engine are torn down on unmount.

### `pages/WorldPage.jsx` (modified)

Takes a `show` prop (real `Show` object) instead of owning `PLACEHOLDER_CHARACTERS`. Builds the character list from `show.contestants`, assigning `spriteKey` by array position (`contestants[0]` → `slot-1`, etc.) so any 5-of-8 preset combination still gets 5 visually distinct characters. Renders a "Start Round" control (matching the existing pattern in `LiveRoom`) that calls `startRound(showId)`; independent of the WebSocket connection, which `WorldView` opens regardless, so characters keep wandering even before a round is started and pick up events whenever one is running.

### `App.jsx` (modified)

Goes back to a real flow: renders `ShowSetup` until a show is created (via its existing `onCreated` callback), then renders `WorldPage` with that show.

## Data flow

Backend event → WebSocket → `WorldView`'s `onEvent` → `eventMapping.js` → `engine.handleEvent(command)` → enqueued onto the relevant character(s)' `queue` → `interactions.js` (consulted every `update()` tick) drives `mode` transitions and, for private messages, `pathfinding.js` → `engine.draw()` renders the canvas as today → `engine`'s `onFrame` callback → `WorldView`'s throttled React state → bubble/banner overlay divs. Uninvolved characters' data never leaves the engine's normal wander path.

## Error handling

- WebSocket connection failure/drop: not handled specially in this phase — characters simply keep wandering with no events arriving, same as before a round starts. A reconnect strategy is a reasonable fast-follow, not required here.
- Pathfinding failure (no path to an adjacent tile — shouldn't happen in this room's layout): fall back to showing the bubble without repositioning, rather than getting the character stuck in `walking-to-interact` forever.
- Malformed/unexpected event kind from `eventMapping.js`: maps to `null` and is silently ignored (mirrors how `NARRATION` is handled), rather than throwing and breaking the engine loop.

## Testing

- `pathfinding.js`: pure unit tests — reachable adjacent tile found, already-adjacent returns an empty/trivial path, unreachable returns `null`.
- `eventMapping.js`: pure unit tests, one per event-kind → command mapping, plus the `NARRATION`/unknown-kind → `null` case.
- `interactions.js`: pure unit tests over plain character-state fixtures — a private message only activates once both participants' queues have it at the front; mode transitions happen in the right order; bubble duration elapsing dequeues and returns to `wander`.
- `engine.js`: existing tests continue to cover `update()`/`draw()`/start/stop; new tests cover `handleEvent()` enqueueing and the `onFrame` callback firing with the expected snapshot shape, following the existing fake-context/fake-images/injected-rng pattern.
- `WorldView.jsx`: existing tests continue to cover canvas/engine lifecycle; new tests mock `openEventSocket` (matching how `WorldView` already mocks `loadImage`/`WorldEngine`) and assert bubble/banner overlays render from a fed-in event, without needing a real WebSocket.
- No end-to-end test against a real backend in this phase — consistent with the rest of this codebase's test suite, which never makes real network calls.

## Open follow-up (not this spec)

- WebSocket reconnect-on-drop handling.
- Visualizing agent status changes (warned/eliminated) in the World view.
- Any interactivity (click a character to inspect their latest event).

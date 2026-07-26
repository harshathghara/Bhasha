# Gamified World UI — Design Spec

**Goal:** Build a small, top-down pixel-art "world" view in the existing Bhram frontend — a single room (the house's central hall) where character sprites wander around on their own, in the visual style of classic Pokemon overworld screens. This first phase builds the world and its movement mechanics with placeholder characters only. Wiring it to the show's real 5 agents (live positions, names, personalities reflected visually) is explicitly out of scope and deferred to a follow-up spec.

**Context:** The backend and REST/WebSocket API for Bhram (5 LLM agents in a reality-show simulator) already exist, along with a React/Vite frontend (`ShowSetup`, `LiveRoom`, `EventFeed` components, an `api/client.js`). There is currently no app shell (`App.jsx`) or routing in the frontend — that was out of scope for the original harness plan. This spec's world view is additive: it does not touch `ShowSetup`/`LiveRoom`/`EventFeed`, but does introduce the first minimal app shell needed to reach a new page.

## Non-goals (this phase)

- Connecting to real agent data, live positions, or backend events. Characters are hardcoded placeholders.
- Multiple rooms, doorways, or room transitions. Just the central hall.
- Any interaction (click-to-inspect, dialogue bubbles, producer controls). Characters just wander.
- A map editor or configurable layouts. The room is a hardcoded tile grid.
- Wiring this page into the existing ShowSetup → LiveRoom flow. It's reachable as its own page via a minimal, temporary view switcher.

## Architecture

The core principle: **the animation loop lives outside React**, driven by a plain JS engine object, not React state. Canvas redraws happen imperatively on every `requestAnimationFrame` tick; React only mounts/unmounts the engine and never re-renders per frame. This avoids the reconciliation overhead of storing per-frame position/animation state in `useState`, and keeps the movement/collision logic trivially unit-testable in isolation from any rendering or React concerns.

```
frontend/src/
  pages/
    WorldPage.jsx          # page wrapper, hosts WorldView, holds placeholder character list
  components/
    WorldView.jsx           # thin React shell: <canvas> + useEffect to start/stop the engine
  world/
    engine.js                # WorldEngine class: game loop, draws to canvas, owns character state
    map.js                    # tile grid constants for the central hall room
    movement.js               # pure functions: tile validity, random-adjacent-tile choice, occupancy
    sprites.js                 # sprite sheet loading + frame-lookup helpers
    assets/
      tileset.png               # sourced open-license tileset
      characters.png             # sourced open-license character walk-cycle spritesheet(s)
      CREDITS.md                  # attribution for the asset pack's license
  App.jsx                     # minimal shell: local state toggle between "setup" (existing) and "world" (new)
  main.jsx                     # Vite/React entrypoint, mounts App
```

### Why an app shell now

There is no `App.jsx` today. To make the world page reachable at all, this spec adds the smallest possible shell: a top-level component holding a `view` state (`"setup" | "world"`) and a couple of buttons/links to switch between them. It does **not** attempt to wire `ShowSetup`'s `onCreated` callback into a real navigation flow, and does not touch `LiveRoom`/`EventFeed` — those remain exactly as they are, simply not reachable from this shell yet. That integration is later work.

## Components

### `WorldEngine` (`world/engine.js`)

A plain JS class, no React/DOM framework dependency beyond the `CanvasRenderingContext2D` it's given.

- `constructor(canvasContext, characters)` — stores the 2D context and the initial character list (each `{ id, name, spriteKey, tileX, tileY, direction, animFrame }`).
- `start()` — begins the `requestAnimationFrame` loop.
- `stop()` — cancels the loop (`cancelAnimationFrame`).
- Internally, each tick: advances any in-progress walk animations, and for characters not currently mid-step, rolls a randomized per-character timer to decide when their next move happens (so all 5 don't step in lockstep), calls into `movement.js`'s pure functions to pick a target tile, and redraws the room + all characters to the canvas.

### `movement.js` (pure functions, unit-tested directly)

- `isWalkable(map, tileX, tileY) -> bool` — tile is in bounds and not a wall.
- `pickRandomAdjacentTile(map, character, occupiedTiles) -> {x, y} | null` — returns a random valid, unoccupied, walkable neighbor tile, or `null` if none exist (character idles that tick).
- `occupiedTiles(characters, excludingId) -> Set<"x,y">` — tiles currently occupied or being walked into by other characters, so two characters don't target the same tile.

### `map.js`

- A single exported 2D array (or array-of-strings, whichever is more readable) representing the central hall: a perimeter of wall tiles around a floor interior, with maybe one or two prop tiles (a table/couch) that also count as non-walkable. Tile dimensions and room size are fixed constants for this phase.

### `sprites.js`

- Loads the tileset/character spritesheet images once and exposes simple lookups: given a tile type, which sub-rectangle of `tileset.png` to draw; given a character's `direction` + `animFrame`, which sub-rectangle of `characters.png` to draw. No animation logic here — just frame lookup.

### `WorldView.jsx`

- Props: `characters` (the placeholder list, passed down from `WorldPage`).
- Renders a `<canvas>` sized to the room's pixel dimensions (tile size × grid width/height).
- `useEffect`: on mount, get the 2D context, construct a `WorldEngine`, call `.start()`; cleanup function calls `.stop()`.
- No other state, no other props. A dumb shell.

### `WorldPage.jsx`

- Defines the hardcoded placeholder character list (5 entries: `{id: "slot-1", name: "Housemate 1", spriteKey: "default"}` … `slot-5`), each currently using the same generic `spriteKey` since there's no per-character art yet.
- Renders `<WorldView characters={PLACEHOLDER_CHARACTERS} />`.

### `App.jsx`

- Minimal: `useState` for `view`, conditionally renders `ShowSetup`/a small placeholder for "setup flow" vs `WorldPage`, with two buttons to switch. This is intentionally throwaway scaffolding, not a real router — a real navigation model is future work once the world connects to real show data.

## Data flow

`WorldPage` owns the placeholder character array (static, no fetching). It passes it once to `WorldView`, which hands it once to `WorldEngine` at construction. All subsequent position/animation/frame updates happen entirely inside the engine's internal state — nothing flows back up into React. There is no data flow between this feature and the existing `api/client.js`/backend in this phase.

## Error handling

- If the tileset/character spritesheet images fail to load (e.g. missing file), `sprites.js`'s loader should surface a clear console error and `WorldView` should render a simple fallback message ("World assets failed to load") instead of a blank/broken canvas — this is a local dev/build-time concern, not a runtime-recoverable error path, since assets are bundled at build time.
- No other error handling is meaningful here: no network calls, no user input to validate in this phase.

## Testing

- `movement.js`: plain Vitest unit tests — tile-walkability checks (in-bounds vs out-of-bounds vs wall), random-adjacent-tile selection returning only valid candidates (seed/mock `Math.random` to make selection deterministic in tests), occupancy exclusion (a targeted-but-not-yet-arrived tile counts as occupied).
- `WorldView.jsx`: mount test asserting a `<canvas>` element renders with the expected pixel dimensions; assert the engine's `start` is called on mount and `stop` on unmount, using a mocked `requestAnimationFrame`/`cancelAnimationFrame` (matching this codebase's existing pattern of faking timers/mocking the network boundary rather than using real ones).
- No pixel-level / visual-diff testing — canvas drawing output is not asserted on. Rendering correctness is a manual/visual check (`npm run dev`, look at it), consistent with this being a hackathon-scale local harness (per the original plan's Global Constraints: no deployment concerns, local run only).

## Assets

- **Amended during planning:** rather than sourcing an external open-license pack (network-dependent, license-verification risk, uncertain layout match against what the rendering code expects), the tileset and character walk-cycle spritesheets are generated deterministically by a committed script (`frontend/scripts/generate_placeholder_assets.py`, Python + Pillow) — simple solid-colored shapes to an exact grid layout contract (32px tiles, 4-direction × 4-frame character sheets). Zero licensing risk, fully reproducible, and the layout contract is exactly what a future real-art swap must match. Attribution/provenance recorded in `frontend/src/world/assets/CREDITS.md`.
- A real pixel-art pack (LPC-style or otherwise) swapping in for these placeholders, without any rendering-code changes, is explicit follow-up work — see "Open follow-up" below.

## Open follow-up (not this spec)

- Connecting `WorldPage`'s character list to the backend's real 5 agents (names, live status, personality-driven visual differentiation).
- Multiple rooms / room transitions (confession booth, bedrooms) matching the show's actual locations.
- Any interactivity (click a character to inspect, see their latest event/confession).
- A real navigation/routing setup replacing the throwaway `App.jsx` view toggle.
- Swapping the generated placeholder tileset/character art for a real licensed or commissioned pixel-art pack, matching the existing 32px/4-direction/4-frame grid contract.

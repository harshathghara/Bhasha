# World Character Interactions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect the World UI to the real Bhram backend — the 5 wandering characters become the show's actual contestants, and public speech, private messages, and confessions play out visually: characters walk toward each other, face each other, and show chat bubbles; GM rulings/announcements show as a dismissing banner.

**Architecture:** A per-character state machine (`mode`: `wander` → `walking-to-interact` → `interacting` → `wander`) extends the existing `WorldEngine.update()` loop, driven by a per-character FIFO `queue` of interaction commands built from incoming backend events. A small BFS pathfinder walks characters to a tile adjacent to their conversation partner; a pure event-mapping function translates raw backend events into commands. Bubbles and the GM banner are HTML/CSS overlays (not canvas-drawn), fed by a throttled `onFrame` snapshot callback on the engine, positioned as percentages over the canvas so they track it regardless of CSS scaling.

**Tech Stack:** React 18 + Vite, HTML5 Canvas (unchanged), Vitest + @testing-library/react. No new npm dependency.

## Global Constraints

- The animation loop stays entirely inside `WorldEngine`; interaction logic is pure functions in `world/interactions.js` and `world/pathfinding.js`, called from `engine.update()` — no parallel system that mutates characters from outside the engine.
- Bubble styling: white background, black text. Icons are plain Unicode glyphs (no new asset files): 💬 public, 🔒 private, 💭 confession.
- Bubble/interaction duration is a single fixed constant (`INTERACTION_DURATION_MS = 3500`), reused for public speech, private messages, confessions, and the GM banner — not scaled to message length.
- Bubble text is truncated to 80 characters + `…` when rendered (full text already exists in `EventFeed` elsewhere in the app).
- Private-message target tiles are captured once, when the interaction starts (a snapshot of the partner's position at that moment) — never continuously re-chased.
- The GM has no character sprite; `GM_RULING`/`GM_ANNOUNCEMENT` events never touch any character's queue — they only set a bottom-docked banner. `NARRATION` events are ignored entirely (already shown in `EventFeed`'s Story tab).
- Characters not involved in the current event keep wandering exactly as before — interaction state is strictly per-character.
- Tests never make a real network call or open a real WebSocket: `openEventSocket` and `WorldEngine` are mocked in component tests, matching this codebase's existing pattern (`loadImage` is already mocked this way in `WorldView.test.jsx`).

## File Structure

```
frontend/src/
  world/
    pathfinding.js       # new — BFS to a tile adjacent to a target
    pathfinding.test.js
    eventMapping.js       # new — backend Event -> interaction command
    eventMapping.test.js
    interactions.js         # new — per-character state machine transitions
    interactions.test.js
    engine.js                # modified — integrates the above, handleEvent(), onFrame
    engine.test.js
  components/
    WorldView.jsx          # modified — showId prop, WebSocket wiring, bubble/banner overlays
    WorldView.test.jsx
  pages/
    WorldPage.jsx            # modified — takes a real `show` prop, Start round button
    WorldPage.test.jsx
  App.jsx                     # modified — real ShowSetup -> WorldPage flow
  App.test.jsx
```

---

### Task 1: Pathfinding

**Files:**
- Create: `frontend/src/world/pathfinding.js`
- Test: `frontend/src/world/pathfinding.test.js`

**Interfaces:**
- Consumes `isWalkable(x, y)` (existing, from `world/movement.js`).
- Produces `findPathToAdjacent(start, goal) -> Array<{x, y}> | null` — `start`/`goal` are `{x, y}` tile coordinates. Returns `[]` if `start` already equals or is orthogonally adjacent to `goal` (no walking needed). Returns the shortest ordered list of tiles to step through (not including `start`) ending on a tile adjacent to `goal`, via breadth-first search over the existing map grid. Returns `null` if no such tile is reachable.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/world/pathfinding.test.js`:

```javascript
import { describe, it, expect } from "vitest";
import { findPathToAdjacent } from "./pathfinding";

describe("findPathToAdjacent", () => {
  it("returns an empty path when already adjacent", () => {
    expect(findPathToAdjacent({ x: 1, y: 1 }, { x: 2, y: 1 })).toEqual([]);
  });

  it("returns an empty path when start equals goal", () => {
    expect(findPathToAdjacent({ x: 1, y: 1 }, { x: 1, y: 1 })).toEqual([]);
  });

  it("finds a shortest path ending adjacent to the goal", () => {
    const path = findPathToAdjacent({ x: 1, y: 1 }, { x: 6, y: 1 });
    expect(path).not.toBeNull();
    const last = path[path.length - 1];
    expect(Math.abs(last.x - 6) + Math.abs(last.y - 1)).toBe(1);
    expect(path).toHaveLength(4); // (1,1) -> (2,1) -> (3,1) -> (4,1) -> (5,1)
  });

  it("routes around the couch obstacle at (4,3)-(5,3)", () => {
    const path = findPathToAdjacent({ x: 4, y: 2 }, { x: 4, y: 4 });
    expect(path).not.toBeNull();
    for (const step of path) {
      expect(step).not.toEqual({ x: 4, y: 3 });
      expect(step).not.toEqual({ x: 5, y: 3 });
    }
  });

  it("returns null when the goal is unreachable", () => {
    expect(findPathToAdjacent({ x: 1, y: 1 }, { x: -5, y: -5 })).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run from `frontend/`: `npm test -- pathfinding.test.js`
Expected: FAIL — `pathfinding.js` does not exist.

- [ ] **Step 3: Implement `frontend/src/world/pathfinding.js`**

```javascript
import { isWalkable } from "./movement";

const NEIGHBOR_DELTAS = [
  { dx: 0, dy: -1 },
  { dx: 0, dy: 1 },
  { dx: -1, dy: 0 },
  { dx: 1, dy: 0 },
];

function isAdjacent(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1;
}

export function findPathToAdjacent(start, goal) {
  if (start.x === goal.x && start.y === goal.y) return [];
  if (isAdjacent(start, goal)) return [];

  const key = (p) => `${p.x},${p.y}`;
  const visited = new Set([key(start)]);
  const queue = [{ pos: start, path: [] }];

  while (queue.length > 0) {
    const { pos, path } = queue.shift();

    for (const { dx, dy } of NEIGHBOR_DELTAS) {
      const next = { x: pos.x + dx, y: pos.y + dy };
      if (visited.has(key(next))) continue;
      if (!isWalkable(next.x, next.y)) continue;

      const nextPath = [...path, next];
      if (isAdjacent(next, goal)) return nextPath;

      visited.add(key(next));
      queue.push({ pos: next, path: nextPath });
    }
  }

  return null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- pathfinding.test.js`
Expected: 5 tests passing.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/world/pathfinding.js frontend/src/world/pathfinding.test.js
git commit -m "feat: add BFS pathfinding to a tile adjacent to a target"
```

---

### Task 2: Event mapping

**Files:**
- Create: `frontend/src/world/eventMapping.js`
- Test: `frontend/src/world/eventMapping.test.js`

**Interfaces:**
- Produces `mapEvent(event) -> Command | null`. `event` is a raw backend event as delivered over the WebSocket: `{seq, sender_id, text, kind, visibility, recipients}`. A `Command` is `{id, kind: "public"|"private"|"confession"|"gm", senderId, recipientId?, text}`, where `id` is the event's `seq` (unique per event, used later to match a private command across both participants' queues). Mapping: `kind: "agent_action"` + `visibility: "public"` → `public`; `"agent_action"` + `"private"` → `private` (`recipientId` = `recipients[0]`); `kind: "confession"` → `confession`; `kind: "gm_ruling"` or `"gm_announcement"` → `gm` (no `senderId`/`recipientId`, GM has no character); `kind: "narration"` or anything unrecognized → `null`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/world/eventMapping.test.js`:

```javascript
import { describe, it, expect } from "vitest";
import { mapEvent } from "./eventMapping";

function baseEvent(overrides = {}) {
  return {
    seq: 5, round: 1, sender_id: "vikram", text: "hello", kind: "agent_action",
    visibility: "public", recipients: [], released: false, timestamp: 0, ...overrides,
  };
}

describe("mapEvent", () => {
  it("maps a public agent action", () => {
    expect(mapEvent(baseEvent())).toEqual({
      id: 5, kind: "public", senderId: "vikram", text: "hello",
    });
  });

  it("maps a private agent action, taking the first recipient", () => {
    const event = baseEvent({ visibility: "private", recipients: ["meera"] });
    expect(mapEvent(event)).toEqual({
      id: 5, kind: "private", senderId: "vikram", recipientId: "meera", text: "hello",
    });
  });

  it("maps a confession", () => {
    const event = baseEvent({ kind: "confession", visibility: "private", recipients: [] });
    expect(mapEvent(event)).toEqual({
      id: 5, kind: "confession", senderId: "vikram", text: "hello",
    });
  });

  it("maps a GM ruling and a GM announcement to the same gm command shape", () => {
    expect(mapEvent(baseEvent({ kind: "gm_ruling", sender_id: "game_master" }))).toEqual({
      id: 5, kind: "gm", text: "hello",
    });
    expect(mapEvent(baseEvent({ kind: "gm_announcement", sender_id: "game_master" }))).toEqual({
      id: 5, kind: "gm", text: "hello",
    });
  });

  it("returns null for narration", () => {
    expect(mapEvent(baseEvent({ kind: "narration" }))).toBeNull();
  });

  it("returns null for an unrecognized kind", () => {
    expect(mapEvent(baseEvent({ kind: "something_new" }))).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- eventMapping.test.js`
Expected: FAIL — `eventMapping.js` does not exist.

- [ ] **Step 3: Implement `frontend/src/world/eventMapping.js`**

```javascript
export function mapEvent(event) {
  if (event.kind === "agent_action" && event.visibility === "public") {
    return {
      id: event.seq, kind: "public", senderId: event.sender_id, text: event.text,
    };
  }

  if (event.kind === "agent_action" && event.visibility === "private") {
    return {
      id: event.seq,
      kind: "private",
      senderId: event.sender_id,
      recipientId: event.recipients[0],
      text: event.text,
    };
  }

  if (event.kind === "confession") {
    return {
      id: event.seq, kind: "confession", senderId: event.sender_id, text: event.text,
    };
  }

  if (event.kind === "gm_ruling" || event.kind === "gm_announcement") {
    return { id: event.seq, kind: "gm", text: event.text };
  }

  return null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- eventMapping.test.js`
Expected: 6 tests passing.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/world/eventMapping.js frontend/src/world/eventMapping.test.js
git commit -m "feat: add backend event to interaction command mapping"
```

---

### Task 3: Interaction state machine

**Files:**
- Create: `frontend/src/world/interactions.js`
- Test: `frontend/src/world/interactions.test.js`

**Interfaces:**
- Consumes nothing from earlier tasks directly (takes a `findPath` function injected by the caller, matching Task 1's `findPathToAdjacent` signature).
- Produces `INTERACTION_DURATION_MS` (`3500`), `directionToward(fromX, fromY, toX, toY) -> "up"|"down"|"left"|"right"`, `isCommandReady(character, charactersById) -> bool`, `beginInteracting(character, direction) -> void` (mutates), `startCommand(character, charactersById, findPath) -> void` (mutates), `advanceWalkingToInteract(character, deltaMs, charactersById) -> void` (mutates), `advanceInteracting(character, deltaMs) -> void` (mutates). `charactersById` is a `Map<string, character>`. A `character` for this module needs at least: `id, tileX, tileY, direction, moving, walkProgress, targetX, targetY, mode, queue, path, activeCommand, interactingRemainingMs`.
- `isCommandReady`: the command at the front of `character.queue` — always ready for `public`/`confession`; for `private`, ready only once the same command (by `id`) is also at the front of the partner's queue.
- `startCommand`: for `public`/`confession`, calls `beginInteracting` immediately (no walking) facing the character's current direction. For `private`, calls `findPath` from the character's tile to the partner's tile; if a non-empty path comes back, sets `mode = "walking-to-interact"` and `path`; if the path is empty (already adjacent) or `null` (unreachable), calls `beginInteracting` facing the partner directly.
- `advanceWalkingToInteract`: steps the character through `path` one tile at a time (reusing the same single-step move/interpolate pattern as the engine's existing wander movement); once `path` is exhausted, calls `beginInteracting` facing the partner.
- `advanceInteracting`: counts `interactingRemainingMs` down by `deltaMs`; once it reaches zero or below, dequeues the completed command (`queue = queue.slice(1)`), clears `activeCommand`, and sets `mode = "wander"`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/world/interactions.test.js`:

```javascript
import { describe, it, expect } from "vitest";
import {
  INTERACTION_DURATION_MS,
  isCommandReady,
  startCommand,
  advanceWalkingToInteract,
  advanceInteracting,
  directionToward,
} from "./interactions";

function baseCharacter(overrides = {}) {
  return {
    id: "a", tileX: 1, tileY: 1, direction: "down", moving: false, walkProgress: 0,
    targetX: undefined, targetY: undefined, mode: "wander", queue: [], path: [],
    activeCommand: null, interactingRemainingMs: 0, ...overrides,
  };
}

describe("directionToward", () => {
  it("returns the direction from one point toward another", () => {
    expect(directionToward(0, 0, 1, 0)).toBe("right");
    expect(directionToward(1, 0, 0, 0)).toBe("left");
    expect(directionToward(0, 0, 0, 1)).toBe("down");
    expect(directionToward(0, 1, 0, 0)).toBe("up");
  });
});

describe("isCommandReady", () => {
  it("is always ready for public and confession commands", () => {
    const character = baseCharacter({ queue: [{ id: 1, kind: "public", senderId: "a", text: "hi" }] });
    expect(isCommandReady(character, new Map())).toBe(true);
  });

  it("is not ready for a private command until the partner has it queued too", () => {
    const command = { id: 1, kind: "private", senderId: "a", recipientId: "b", text: "psst" };
    const sender = baseCharacter({ id: "a", queue: [command] });
    const recipient = baseCharacter({ id: "b", queue: [] });
    const byId = new Map([["a", sender], ["b", recipient]]);

    expect(isCommandReady(sender, byId)).toBe(false);

    recipient.queue = [command];
    expect(isCommandReady(sender, byId)).toBe(true);
  });
});

describe("startCommand", () => {
  it("begins interacting immediately for a public command, facing unchanged", () => {
    const command = { id: 1, kind: "public", senderId: "a", text: "hi" };
    const character = baseCharacter({ queue: [command], direction: "left" });

    startCommand(character, new Map([["a", character]]), () => []);

    expect(character.mode).toBe("interacting");
    expect(character.direction).toBe("left");
    expect(character.interactingRemainingMs).toBe(INTERACTION_DURATION_MS);
  });

  it("walks toward the partner for a private command when a path exists", () => {
    const command = { id: 1, kind: "private", senderId: "a", recipientId: "b", text: "psst" };
    const sender = baseCharacter({ id: "a", tileX: 1, tileY: 1, queue: [command] });
    const recipient = baseCharacter({ id: "b", tileX: 5, tileY: 1 });
    const byId = new Map([["a", sender], ["b", recipient]]);
    const fakePath = [{ x: 2, y: 1 }, { x: 3, y: 1 }];

    startCommand(sender, byId, () => fakePath);

    expect(sender.mode).toBe("walking-to-interact");
    expect(sender.path).toEqual(fakePath);
  });

  it("skips walking and interacts in place when already adjacent (empty path)", () => {
    const command = { id: 1, kind: "private", senderId: "a", recipientId: "b", text: "psst" };
    const sender = baseCharacter({ id: "a", tileX: 1, tileY: 1, queue: [command] });
    const recipient = baseCharacter({ id: "b", tileX: 2, tileY: 1 });
    const byId = new Map([["a", sender], ["b", recipient]]);

    startCommand(sender, byId, () => []);

    expect(sender.mode).toBe("interacting");
    expect(sender.direction).toBe("right");
  });

  it("falls back to interacting in place when no path exists", () => {
    const command = { id: 1, kind: "private", senderId: "a", recipientId: "b", text: "psst" };
    const sender = baseCharacter({ id: "a", tileX: 1, tileY: 1, queue: [command] });
    const recipient = baseCharacter({ id: "b", tileX: 8, tileY: 6 });
    const byId = new Map([["a", sender], ["b", recipient]]);

    startCommand(sender, byId, () => null);

    expect(sender.mode).toBe("interacting");
  });
});

describe("advanceWalkingToInteract", () => {
  it("steps through the path tile by tile, then transitions to interacting facing the partner", () => {
    const command = { id: 1, kind: "private", senderId: "a", recipientId: "b", text: "psst" };
    const recipient = baseCharacter({ id: "b", tileX: 3, tileY: 1 });
    const character = baseCharacter({
      id: "a", tileX: 1, tileY: 1, mode: "walking-to-interact",
      path: [{ x: 2, y: 1 }], activeCommand: command,
    });
    const byId = new Map([["a", character], ["b", recipient]]);

    advanceWalkingToInteract(character, 16, byId);
    expect(character.moving).toBe(true);
    expect(character.targetX).toBe(2);
    expect(character.path).toEqual([]);

    advanceWalkingToInteract(character, 1000, byId);
    expect(character.moving).toBe(false);
    expect(character.tileX).toBe(2);

    advanceWalkingToInteract(character, 16, byId);
    expect(character.mode).toBe("interacting");
    expect(character.direction).toBe("right");
  });
});

describe("advanceInteracting", () => {
  it("counts down and returns to wander, dequeuing the command, once time elapses", () => {
    const command = { id: 1, kind: "public", senderId: "a", text: "hi" };
    const character = baseCharacter({
      mode: "interacting", queue: [command], activeCommand: command,
      interactingRemainingMs: 100,
    });

    advanceInteracting(character, 50);
    expect(character.mode).toBe("interacting");

    advanceInteracting(character, 60);
    expect(character.mode).toBe("wander");
    expect(character.queue).toEqual([]);
    expect(character.activeCommand).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- interactions.test.js`
Expected: FAIL — `interactions.js` does not exist.

- [ ] **Step 3: Implement `frontend/src/world/interactions.js`**

```javascript
export const INTERACTION_DURATION_MS = 3500;
const INTERACT_WALK_DURATION_MS = 350;

export function directionToward(fromX, fromY, toX, toY) {
  if (toX > fromX) return "right";
  if (toX < fromX) return "left";
  if (toY > fromY) return "down";
  return "up";
}

export function isCommandReady(character, charactersById) {
  const command = character.queue[0];
  if (!command) return false;
  if (command.kind !== "private") return true;

  const partnerId = command.senderId === character.id ? command.recipientId : command.senderId;
  const partner = charactersById.get(partnerId);
  if (!partner) return false;
  return Boolean(partner.queue[0] && partner.queue[0].id === command.id);
}

export function beginInteracting(character, direction) {
  character.mode = "interacting";
  character.direction = direction;
  character.interactingRemainingMs = INTERACTION_DURATION_MS;
  character.moving = false;
  character.path = [];
}

export function startCommand(character, charactersById, findPath) {
  const command = character.queue[0];
  character.activeCommand = command;

  if (command.kind !== "private") {
    beginInteracting(character, character.direction);
    return;
  }

  const partnerId = command.senderId === character.id ? command.recipientId : command.senderId;
  const partner = charactersById.get(partnerId);
  const path = findPath(
    { x: character.tileX, y: character.tileY },
    { x: partner.tileX, y: partner.tileY },
  );

  if (path && path.length > 0) {
    character.mode = "walking-to-interact";
    character.path = path;
  } else {
    beginInteracting(
      character,
      directionToward(character.tileX, character.tileY, partner.tileX, partner.tileY),
    );
  }
}

export function advanceWalkingToInteract(character, deltaMs, charactersById) {
  if (!character.moving) {
    const next = character.path[0];
    if (!next) {
      const command = character.activeCommand;
      const partnerId = command.senderId === character.id ? command.recipientId : command.senderId;
      const partner = charactersById.get(partnerId);
      const direction = partner
        ? directionToward(character.tileX, character.tileY, partner.tileX, partner.tileY)
        : character.direction;
      beginInteracting(character, direction);
      return;
    }

    character.targetX = next.x;
    character.targetY = next.y;
    character.direction = directionToward(character.tileX, character.tileY, next.x, next.y);
    character.moving = true;
    character.walkProgress = 0;
    character.path = character.path.slice(1);
    return;
  }

  character.walkProgress += deltaMs / INTERACT_WALK_DURATION_MS;
  if (character.walkProgress >= 1) {
    character.tileX = character.targetX;
    character.tileY = character.targetY;
    character.targetX = undefined;
    character.targetY = undefined;
    character.moving = false;
    character.walkProgress = 0;
  }
}

export function advanceInteracting(character, deltaMs) {
  character.interactingRemainingMs -= deltaMs;
  if (character.interactingRemainingMs <= 0) {
    character.queue = character.queue.slice(1);
    character.activeCommand = null;
    character.mode = "wander";
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- interactions.test.js`
Expected: 8 tests passing.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/world/interactions.js frontend/src/world/interactions.test.js
git commit -m "feat: add per-character interaction state machine"
```

---

### Task 4: Wire interactions into the engine

**Files:**
- Modify: `frontend/src/world/engine.js`
- Modify: `frontend/src/world/engine.test.js`

**Interfaces:**
- Consumes `mapEvent` (Task 2), `findPathToAdjacent` (Task 1), `INTERACTION_DURATION_MS`/`isCommandReady`/`startCommand`/`advanceWalkingToInteract`/`advanceInteracting` (Task 3).
- `WorldEngine` constructor: each character now also gets `mode: "wander"`, `queue: []`, `path: []`, `activeCommand: null`, `interactingRemainingMs: 0`. The engine gains `this.gmBanner = null` and reads a new `options.onFrame` callback (stored as `this.onFrame`, default `null`).
- Produces `engine.handleEvent(rawEvent) -> void` — maps the event via `mapEvent`; for a `gm` command, sets `this.gmBanner = {text, remainingMs: INTERACTION_DURATION_MS}` and returns (no character touched); for `public`/`confession`, pushes the command onto the sender's `queue`; for `private`, pushes the same command object onto both the sender's and recipient's `queue`. Unknown senders/recipients are silently skipped (no matching character found).
- `update(deltaMs)`: for each character, if `mode === "interacting"` calls `advanceInteracting`; if `mode === "walking-to-interact"` calls `advanceWalkingToInteract`; otherwise (mode `"wander"`), if the queue is non-empty and `isCommandReady`, calls `startCommand` (skipping the existing random-wander logic that tick); otherwise runs the existing random-wander logic unchanged. Also counts down `this.gmBanner.remainingMs` if set, clearing it at zero.
- `draw()`: unchanged tile/character drawing, but now calls `this.onFrame(this.buildFrameSnapshot())` at the end if `this.onFrame` is set.
- Produces `buildFrameSnapshot() -> {characters: Array<{id, pixelX, pixelY, mode, bubble}>, gmBanner: {text} | null}`. `bubble` is `{kind, text}` only when the character is `interacting` with an `activeCommand` whose `senderId` is that character's own id (so only the sender of a private message gets a bubble, not the recipient); otherwise `null`.
- Pixel-position interpolation is factored out of `draw()` into a shared `characterPixelPosition(character)` helper, reused by `buildFrameSnapshot()` — do not duplicate the interpolation formula.

- [ ] **Step 1: Write the failing tests**

Add to the end of `frontend/src/world/engine.test.js` (keep all existing content above it unchanged):

```javascript
describe("WorldEngine.handleEvent", () => {
  it("enqueues a public command onto the sender only", () => {
    const sender = baseCharacter({ id: "a" });
    const other = baseCharacter({ id: "b", tileX: 5, tileY: 5 });
    const engine = new WorldEngine(fakeContext(), [sender, other], fakeImages());

    engine.handleEvent({
      seq: 1, sender_id: "a", text: "hi all", kind: "agent_action",
      visibility: "public", recipients: [],
    });

    expect(engine.characters[0].queue).toHaveLength(1);
    expect(engine.characters[1].queue).toHaveLength(0);
  });

  it("enqueues a private command onto both sender and recipient", () => {
    const sender = baseCharacter({ id: "a" });
    const recipient = baseCharacter({ id: "b", tileX: 5, tileY: 5 });
    const engine = new WorldEngine(fakeContext(), [sender, recipient], fakeImages());

    engine.handleEvent({
      seq: 1, sender_id: "a", text: "psst", kind: "agent_action",
      visibility: "private", recipients: ["b"],
    });

    expect(engine.characters[0].queue).toHaveLength(1);
    expect(engine.characters[1].queue).toHaveLength(1);
    expect(engine.characters[0].queue[0].id).toBe(engine.characters[1].queue[0].id);
  });

  it("sets a GM banner without touching any character", () => {
    const engine = new WorldEngine(fakeContext(), [baseCharacter()], fakeImages());

    engine.handleEvent({
      seq: 1, sender_id: "game_master", text: "Vikram is warned.", kind: "gm_ruling",
      visibility: "public", recipients: [],
    });

    expect(engine.gmBanner).toEqual({ text: "Vikram is warned.", remainingMs: 3500 });
    expect(engine.characters[0].queue).toHaveLength(0);
  });

  it("ignores narration events", () => {
    const engine = new WorldEngine(fakeContext(), [baseCharacter()], fakeImages());

    engine.handleEvent({
      seq: 1, sender_id: "narrator", text: "A tense round.", kind: "narration",
      visibility: "public", recipients: [],
    });

    expect(engine.gmBanner).toBeNull();
    expect(engine.characters[0].queue).toHaveLength(0);
  });
});

describe("WorldEngine public/confession interaction", () => {
  it("moves a character with a ready public command straight into interacting, skipping wander", () => {
    const engine = new WorldEngine(fakeContext(), [baseCharacter()], fakeImages(), { rng: () => 0 });
    engine.characters[0].pauseRemainingMs = 0;
    engine.handleEvent({
      seq: 1, sender_id: "slot-1", text: "hello house", kind: "agent_action",
      visibility: "public", recipients: [],
    });

    engine.update(16);

    const character = engine.characters[0];
    expect(character.mode).toBe("interacting");
    expect(character.moving).toBe(false);
  });

  it("returns to wander once the interaction duration elapses", () => {
    const engine = new WorldEngine(fakeContext(), [baseCharacter()], fakeImages(), { rng: () => 0 });
    engine.characters[0].pauseRemainingMs = 0;
    engine.handleEvent({
      seq: 1, sender_id: "slot-1", text: "hello house", kind: "agent_action",
      visibility: "public", recipients: [],
    });
    engine.update(16);

    engine.update(4000);

    const character = engine.characters[0];
    expect(character.mode).toBe("wander");
    expect(character.queue).toHaveLength(0);
  });
});

describe("WorldEngine private message interaction", () => {
  it("walks both participants toward each other before interacting", () => {
    const sender = baseCharacter({ id: "a", tileX: 1, tileY: 1 });
    const recipient = baseCharacter({ id: "b", tileX: 5, tileY: 1 });
    const engine = new WorldEngine(fakeContext(), [sender, recipient], fakeImages(), { rng: () => 0 });

    engine.handleEvent({
      seq: 1, sender_id: "a", text: "psst", kind: "agent_action",
      visibility: "private", recipients: ["b"],
    });

    engine.update(16);

    expect(engine.characters[0].mode).toBe("walking-to-interact");
    expect(engine.characters[1].mode).toBe("walking-to-interact");
  });
});

describe("WorldEngine onFrame", () => {
  it("reports a bubble for the sender of an interacting public command", () => {
    const onFrame = vi.fn();
    const engine = new WorldEngine(fakeContext(), [baseCharacter()], fakeImages(), {
      rng: () => 0, onFrame,
    });
    engine.characters[0].pauseRemainingMs = 0;
    engine.handleEvent({
      seq: 1, sender_id: "slot-1", text: "hello house", kind: "agent_action",
      visibility: "public", recipients: [],
    });
    engine.update(16);

    engine.draw();

    expect(onFrame).toHaveBeenCalled();
    const snapshot = onFrame.mock.calls[onFrame.mock.calls.length - 1][0];
    expect(snapshot.characters[0].bubble).toEqual({ kind: "public", text: "hello house" });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- engine.test.js`
Expected: FAIL — `handleEvent`/`onFrame`/interaction behavior don't exist yet (existing tests above your additions still pass).

- [ ] **Step 3: Modify `frontend/src/world/engine.js`**

Replace the file's contents with:

```javascript
import { MAP, MAP_WIDTH, MAP_HEIGHT, TILE_SIZE } from "./map";
import { pickRandomAdjacentTile, occupiedTiles } from "./movement";
import { tileSourceRect, characterSourceRect, FRAMES_PER_DIRECTION } from "./sprites";
import { mapEvent } from "./eventMapping";
import { findPathToAdjacent } from "./pathfinding";
import {
  INTERACTION_DURATION_MS,
  isCommandReady,
  startCommand,
  advanceWalkingToInteract,
  advanceInteracting,
} from "./interactions";

const WALK_DURATION_MS = 350;
const MIN_PAUSE_MS = 800;
const MAX_PAUSE_MS = 2000;

export function randomPause(rng = Math.random) {
  return MIN_PAUSE_MS + rng() * (MAX_PAUSE_MS - MIN_PAUSE_MS);
}

function characterPixelPosition(character) {
  const toX = character.moving ? character.targetX : character.tileX;
  const toY = character.moving ? character.targetY : character.tileY;
  const progress = character.moving ? character.walkProgress : 0;
  return {
    pixelX: (character.tileX + (toX - character.tileX) * progress) * TILE_SIZE,
    pixelY: (character.tileY + (toY - character.tileY) * progress) * TILE_SIZE,
  };
}

export class WorldEngine {
  constructor(ctx, characters, images, options = {}) {
    this.ctx = ctx;
    this.images = images;
    this.rng = options.rng || Math.random;
    this.requestFrame = options.requestFrame || ((cb) => requestAnimationFrame(cb));
    this.cancelFrame = options.cancelFrame || ((id) => cancelAnimationFrame(id));
    this.onFrame = options.onFrame || null;
    this.rafId = null;
    this.lastTimestamp = null;
    this.gmBanner = null;

    this.characters = characters.map((character) => ({
      ...character,
      direction: character.direction || "down",
      moving: false,
      walkProgress: 0,
      targetX: undefined,
      targetY: undefined,
      pauseRemainingMs: randomPause(this.rng),
      mode: "wander",
      queue: [],
      path: [],
      activeCommand: null,
      interactingRemainingMs: 0,
    }));
  }

  start() {
    this.lastTimestamp = null;
    const loop = (timestamp) => {
      const delta = this.lastTimestamp === null ? 0 : timestamp - this.lastTimestamp;
      this.lastTimestamp = timestamp;
      this.update(delta);
      this.draw();
      this.rafId = this.requestFrame(loop);
    };
    this.rafId = this.requestFrame(loop);
  }

  stop() {
    if (this.rafId !== null) {
      this.cancelFrame(this.rafId);
      this.rafId = null;
    }
  }

  handleEvent(rawEvent) {
    const command = mapEvent(rawEvent);
    if (!command) return;

    if (command.kind === "gm") {
      this.gmBanner = { text: command.text, remainingMs: INTERACTION_DURATION_MS };
      return;
    }

    const sender = this.characters.find((c) => c.id === command.senderId);
    if (sender) sender.queue.push(command);

    if (command.kind === "private") {
      const recipient = this.characters.find((c) => c.id === command.recipientId);
      if (recipient) recipient.queue.push(command);
    }
  }

  update(deltaMs) {
    const charactersById = new Map(this.characters.map((c) => [c.id, c]));

    for (const character of this.characters) {
      if (character.mode === "interacting") {
        advanceInteracting(character, deltaMs);
        continue;
      }

      if (character.mode === "walking-to-interact") {
        advanceWalkingToInteract(character, deltaMs, charactersById);
        continue;
      }

      if (character.queue.length > 0 && isCommandReady(character, charactersById)) {
        startCommand(character, charactersById, findPathToAdjacent);
        continue;
      }

      if (character.moving) {
        character.walkProgress += deltaMs / WALK_DURATION_MS;
        if (character.walkProgress >= 1) {
          character.tileX = character.targetX;
          character.tileY = character.targetY;
          character.targetX = undefined;
          character.targetY = undefined;
          character.moving = false;
          character.walkProgress = 0;
          character.pauseRemainingMs = randomPause(this.rng);
        }
        continue;
      }

      character.pauseRemainingMs -= deltaMs;
      if (character.pauseRemainingMs > 0) continue;

      const occupied = occupiedTiles(this.characters, character.id);
      const next = pickRandomAdjacentTile(character, occupied, this.rng);
      if (next) {
        character.targetX = next.x;
        character.targetY = next.y;
        character.direction = next.direction;
        character.moving = true;
        character.walkProgress = 0;
      } else {
        character.pauseRemainingMs = randomPause(this.rng);
      }
    }

    if (this.gmBanner) {
      this.gmBanner.remainingMs -= deltaMs;
      if (this.gmBanner.remainingMs <= 0) this.gmBanner = null;
    }
  }

  draw() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, MAP_WIDTH * TILE_SIZE, MAP_HEIGHT * TILE_SIZE);

    for (let y = 0; y < MAP_HEIGHT; y += 1) {
      for (let x = 0; x < MAP_WIDTH; x += 1) {
        const { sx, sy, sw, sh } = tileSourceRect(MAP[y][x]);
        ctx.drawImage(
          this.images.tileset, sx, sy, sw, sh,
          x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE,
        );
      }
    }

    for (const character of this.characters) {
      const { pixelX, pixelY } = characterPixelPosition(character);
      const progress = character.moving ? character.walkProgress : 0;
      const frame = character.moving ? Math.floor(progress * FRAMES_PER_DIRECTION) : 0;
      const { sx, sy, sw, sh } = characterSourceRect(character.direction, frame);
      const sheet = this.images.characters[character.spriteKey];
      ctx.drawImage(sheet, sx, sy, sw, sh, pixelX, pixelY, TILE_SIZE, TILE_SIZE);
    }

    if (this.onFrame) {
      this.onFrame(this.buildFrameSnapshot());
    }
  }

  buildFrameSnapshot() {
    return {
      characters: this.characters.map((character) => {
        const { pixelX, pixelY } = characterPixelPosition(character);
        const bubble = (
          character.mode === "interacting"
          && character.activeCommand
          && character.activeCommand.senderId === character.id
        )
          ? { kind: character.activeCommand.kind, text: character.activeCommand.text }
          : null;
        return {
          id: character.id, pixelX, pixelY, mode: character.mode, bubble,
        };
      }),
      gmBanner: this.gmBanner ? { text: this.gmBanner.text } : null,
    };
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- engine.test.js`
Expected: all tests pass (the 8 pre-existing plus the new ones added in Step 1).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/world/engine.js frontend/src/world/engine.test.js
git commit -m "feat: wire interaction state machine, pathfinding, and events into the engine"
```

---

### Task 5: WorldPage takes a real show

**Files:**
- Modify: `frontend/src/pages/WorldPage.jsx`
- Modify: `frontend/src/pages/WorldPage.test.jsx`

**Interfaces:**
- Consumes `startRound` (existing, `api/client.js`), `WorldView` (Task 6 changes its props, but this task can be implemented/tested independently since `WorldView` is mocked in this task's tests).
- Produces `buildCharacters(show) -> Array<{id, name, spriteKey, tileX, tileY}>` — one entry per `show.contestants[i]`, `spriteKey` = `` `slot-${i + 1}` `` (position-based, so any 5-of-8 preset combination still gets 5 distinct looks), `id`/`name` taken directly from the contestant, `tileX`/`tileY` from a fixed 5-entry spawn-position list (reusing the same positions the old `PLACEHOLDER_CHARACTERS` used).
- Produces `WorldPage({ show })` — renders a "Start round" button that calls `startRound(show.id)`, and `<WorldView showId={show.id} characters={characters} />` where `characters` is `buildCharacters(show)` memoized on `show` so its identity stays stable across re-renders (avoids remounting `WorldView`'s canvas/engine every render).

- [ ] **Step 1: Write the failing test**

Replace `frontend/src/pages/WorldPage.test.jsx` with:

```javascript
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import WorldPage, { buildCharacters } from "./WorldPage";
import WorldView from "../components/WorldView";
import * as api from "../api/client";

vi.mock("../components/WorldView", () => ({
  default: vi.fn(() => <div data-testid="world-view-stub" />),
}));

const show = {
  id: "bhram",
  contestants: [
    { id: "strategist", name: "The Strategist" },
    { id: "diplomat", name: "The Diplomat" },
    { id: "loyalist", name: "The Loyalist" },
    { id: "operator", name: "The Operator" },
    { id: "wildcard", name: "The Wildcard" },
  ],
};

describe("buildCharacters", () => {
  it("assigns spriteKey by position and keeps the real contestant id/name", () => {
    const characters = buildCharacters(show);
    expect(characters).toHaveLength(5);
    expect(characters[0]).toMatchObject({
      id: "strategist", name: "The Strategist", spriteKey: "slot-1",
    });
    expect(characters[4]).toMatchObject({
      id: "wildcard", name: "The Wildcard", spriteKey: "slot-5",
    });
    expect(new Set(characters.map((c) => `${c.tileX},${c.tileY}`)).size).toBe(5);
  });
});

describe("WorldPage", () => {
  it("renders WorldView with the show's id and real contestants", () => {
    render(<WorldPage show={show} />);
    const props = WorldView.mock.calls[0][0];
    expect(props.showId).toBe("bhram");
    expect(props.characters.map((c) => c.id)).toEqual([
      "strategist", "diplomat", "loyalist", "operator", "wildcard",
    ]);
  });

  it("starts the round when Start round is clicked", async () => {
    const spy = vi.spyOn(api, "startRound").mockResolvedValue({ round: 1, narrative: "x" });
    render(<WorldPage show={show} />);

    fireEvent.click(screen.getByRole("button", { name: /start round/i }));

    await waitFor(() => expect(spy).toHaveBeenCalledWith("bhram"));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- WorldPage.test.jsx`
Expected: FAIL — `buildCharacters` doesn't exist, `WorldPage` doesn't accept a `show` prop yet.

- [ ] **Step 3: Modify `frontend/src/pages/WorldPage.jsx`**

Replace the file's contents with:

```javascript
import { useMemo, useState } from "react";
import WorldView from "../components/WorldView";
import { startRound } from "../api/client";

const SPAWN_POSITIONS = [
  { tileX: 2, tileY: 2 },
  { tileX: 4, tileY: 2 },
  { tileX: 6, tileY: 2 },
  { tileX: 3, tileY: 5 },
  { tileX: 6, tileY: 5 },
];

export function buildCharacters(show) {
  return show.contestants.map((contestant, index) => ({
    id: contestant.id,
    name: contestant.name,
    spriteKey: `slot-${index + 1}`,
    ...SPAWN_POSITIONS[index],
  }));
}

export default function WorldPage({ show }) {
  const [starting, setStarting] = useState(false);
  const characters = useMemo(() => buildCharacters(show), [show]);

  async function handleStart() {
    setStarting(true);
    try {
      await startRound(show.id);
    } finally {
      setStarting(false);
    }
  }

  return (
    <div>
      <button onClick={handleStart} disabled={starting}>Start round</button>
      <WorldView showId={show.id} characters={characters} />
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- WorldPage.test.jsx`
Expected: 3 tests passing.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/WorldPage.jsx frontend/src/pages/WorldPage.test.jsx
git commit -m "feat: build WorldPage's characters from the real show and add Start round"
```

---

### Task 6: WorldView — live events, bubbles, GM banner

**Files:**
- Modify: `frontend/src/components/WorldView.jsx`
- Modify: `frontend/src/components/WorldView.test.jsx`

**Interfaces:**
- Consumes `openEventSocket` (existing, `api/client.js`), `WorldEngine` (Task 4's new `onFrame` option and `handleEvent` method).
- Produces `WorldView({ showId, characters })` — on mount, loads assets and starts the engine exactly as before, additionally opens `openEventSocket(showId, onEvent)` where `onEvent` calls `engine.handleEvent(event)`; on unmount, stops the engine and closes the socket. Subscribes to the engine's `onFrame` callback (passed as a constructor option), throttled to at most once per 100ms, storing the latest snapshot in React state. Renders a positioned bubble `<div data-testid="bubble-{id}">` (white background, black text, icon + truncated text) for every character in the snapshot with a non-null `bubble`, and a `<div data-testid="gm-banner">` docked to the bottom when `gmBanner` is set. Bubble/canvas positions stay in sync under CSS scaling because the canvas and the overlay live in the same relatively-positioned wrapper, with bubble position expressed as a percentage of the canvas's native pixel dimensions.

- [ ] **Step 1: Write the failing test**

Replace `frontend/src/components/WorldView.test.jsx` with:

```javascript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import WorldView from "./WorldView";
import { WorldEngine } from "../world/engine";
import { loadImage } from "../world/sprites";
import { openEventSocket } from "../api/client";
import { MAP_WIDTH, MAP_HEIGHT, TILE_SIZE } from "../world/map";

vi.mock("../world/engine", () => ({
  WorldEngine: vi.fn().mockImplementation(() => ({
    start: vi.fn(), stop: vi.fn(), handleEvent: vi.fn(),
  })),
}));

vi.mock("../world/sprites", () => ({
  loadImage: vi.fn(),
}));

vi.mock("../api/client", () => ({
  openEventSocket: vi.fn(),
}));

const characters = [
  { id: "slot-1", name: "Housemate 1", spriteKey: "slot-1", tileX: 1, tileY: 1 },
];

beforeEach(() => {
  vi.clearAllMocks();
  loadImage.mockResolvedValue({});
  HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({});
  openEventSocket.mockReturnValue({ close: vi.fn() });
});

describe("WorldView", () => {
  it("renders a canvas sized to the map", () => {
    render(<WorldView showId="s1" characters={characters} />);
    const canvas = screen.getByTestId("world-canvas");
    expect(canvas.width).toBe(MAP_WIDTH * TILE_SIZE);
    expect(canvas.height).toBe(MAP_HEIGHT * TILE_SIZE);
  });

  it("starts the engine and opens the event socket for the given show", async () => {
    render(<WorldView showId="s1" characters={characters} />);
    await waitFor(() => expect(WorldEngine).toHaveBeenCalledTimes(1));
    const instance = WorldEngine.mock.results[0].value;
    expect(instance.start).toHaveBeenCalledTimes(1);
    expect(openEventSocket).toHaveBeenCalledWith("s1", expect.any(Function));
  });

  it("forwards socket events into the engine", async () => {
    render(<WorldView showId="s1" characters={characters} />);
    await waitFor(() => expect(WorldEngine).toHaveBeenCalledTimes(1));
    const instance = WorldEngine.mock.results[0].value;
    const onEvent = openEventSocket.mock.calls[0][1];

    const event = { seq: 1, sender_id: "slot-1", kind: "agent_action", visibility: "public", text: "hi" };
    onEvent(event);

    expect(instance.handleEvent).toHaveBeenCalledWith(event);
  });

  it("stops the engine and closes the socket on unmount", async () => {
    const close = vi.fn();
    openEventSocket.mockReturnValue({ close });
    const { unmount } = render(<WorldView showId="s1" characters={characters} />);
    await waitFor(() => expect(WorldEngine).toHaveBeenCalledTimes(1));
    const instance = WorldEngine.mock.results[0].value;

    unmount();

    expect(instance.stop).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("shows a fallback message when assets fail to load", async () => {
    loadImage.mockRejectedValue(new Error("404"));
    render(<WorldView showId="s1" characters={characters} />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("alert").textContent).toContain("404");
  });

  it("renders a bubble for a character reported with one, and a GM banner", async () => {
    render(<WorldView showId="s1" characters={characters} />);
    await waitFor(() => expect(WorldEngine).toHaveBeenCalledTimes(1));
    const { onFrame } = WorldEngine.mock.calls[0][3];

    act(() => {
      onFrame({
        characters: [{
          id: "slot-1", pixelX: 32, pixelY: 32, mode: "interacting",
          bubble: { kind: "private", text: "psst" },
        }],
        gmBanner: { text: "Vikram is warned." },
      });
    });

    expect(await screen.findByTestId("bubble-slot-1")).toHaveTextContent("psst");
    expect(screen.getByTestId("gm-banner")).toHaveTextContent("Vikram is warned.");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- WorldView.test.jsx`
Expected: FAIL — `WorldView` doesn't accept `showId`, doesn't call `openEventSocket`, and doesn't render bubbles/banner yet.

- [ ] **Step 3: Modify `frontend/src/components/WorldView.jsx`**

Replace the file's contents with:

```javascript
import { useEffect, useRef, useState } from "react";
import { MAP_WIDTH, MAP_HEIGHT, TILE_SIZE } from "../world/map";
import { loadImage } from "../world/sprites";
import { WorldEngine } from "../world/engine";
import { openEventSocket } from "../api/client";

const FRAME_THROTTLE_MS = 100;
const BUBBLE_TEXT_MAX_LENGTH = 80;
const BUBBLE_ICONS = { public: "\u{1F4AC}", private: "\u{1F512}", confession: "\u{1F4AD}" };

const shellStyle = {
  width: "100vw",
  height: "100vh",
  margin: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "#1a1a1e",
  overflow: "hidden",
};

const frameStyle = {
  position: "relative",
  width: "min(100vw, calc(100vh * 10 / 8))",
  height: "min(100vh, calc(100vw * 8 / 10))",
};

const canvasStyle = {
  width: "100%",
  height: "100%",
  imageRendering: "pixelated",
  display: "block",
};

const overlayStyle = {
  position: "absolute",
  inset: 0,
  pointerEvents: "none",
};

const bubbleStyle = {
  position: "absolute",
  transform: "translate(-50%, -100%)",
  background: "#ffffff",
  color: "#000000",
  borderRadius: "6px",
  padding: "4px 8px",
  fontSize: "12px",
  maxWidth: "160px",
  boxShadow: "0 1px 3px rgba(0,0,0,0.4)",
};

const bannerStyle = {
  position: "absolute",
  bottom: "8px",
  left: "50%",
  transform: "translateX(-50%)",
  background: "#ffffff",
  color: "#000000",
  borderRadius: "6px",
  padding: "6px 12px",
  fontSize: "13px",
  maxWidth: "80%",
};

function truncate(text) {
  if (text.length <= BUBBLE_TEXT_MAX_LENGTH) return text;
  return `${text.slice(0, BUBBLE_TEXT_MAX_LENGTH)}…`;
}

export default function WorldView({ showId, characters }) {
  const canvasRef = useRef(null);
  const [loadError, setLoadError] = useState(null);
  const [frame, setFrame] = useState({ characters: [], gmBanner: null });

  useEffect(() => {
    let engine;
    let socket;
    let cancelled = false;
    let lastFrameStateAt = 0;

    async function setup() {
      try {
        const uniqueSpriteKeys = [...new Set(characters.map((c) => c.spriteKey))];
        const [tileset, ...characterImages] = await Promise.all([
          loadImage(new URL("../world/assets/tileset.png", import.meta.url).href),
          ...uniqueSpriteKeys.map((key) => (
            loadImage(new URL(`../world/assets/char-${key}.png`, import.meta.url).href)
          )),
        ]);

        if (cancelled) return;

        const characterSheets = {};
        uniqueSpriteKeys.forEach((key, index) => {
          characterSheets[key] = characterImages[index];
        });

        const ctx = canvasRef.current.getContext("2d");
        ctx.imageSmoothingEnabled = false;
        engine = new WorldEngine(ctx, characters, { tileset, characters: characterSheets }, {
          onFrame: (snapshot) => {
            const now = performance.now();
            if (now - lastFrameStateAt < FRAME_THROTTLE_MS) return;
            lastFrameStateAt = now;
            setFrame(snapshot);
          },
        });
        engine.start();

        socket = openEventSocket(showId, (event) => {
          if (engine) engine.handleEvent(event);
        });
      } catch (error) {
        if (!cancelled) setLoadError(error.message);
      }
    }

    setup();

    return () => {
      cancelled = true;
      if (engine) engine.stop();
      if (socket) socket.close();
    };
  }, [showId, characters]);

  if (loadError) {
    return (
      <div style={shellStyle}>
        <p role="alert">World assets failed to load: {loadError}</p>
      </div>
    );
  }

  return (
    <div style={shellStyle} data-testid="world-shell">
      <div style={frameStyle}>
        <canvas
          ref={canvasRef}
          width={MAP_WIDTH * TILE_SIZE}
          height={MAP_HEIGHT * TILE_SIZE}
          style={canvasStyle}
          data-testid="world-canvas"
        />
        <div style={overlayStyle}>
          {frame.characters.filter((c) => c.bubble).map((c) => (
            <div
              key={c.id}
              data-testid={`bubble-${c.id}`}
              style={{
                ...bubbleStyle,
                left: `${((c.pixelX + TILE_SIZE / 2) / (MAP_WIDTH * TILE_SIZE)) * 100}%`,
                top: `${(c.pixelY / (MAP_HEIGHT * TILE_SIZE)) * 100}%`,
              }}
            >
              {BUBBLE_ICONS[c.bubble.kind]} {truncate(c.bubble.text)}
            </div>
          ))}
        </div>
        {frame.gmBanner && (
          <div style={bannerStyle} data-testid="gm-banner">{frame.gmBanner.text}</div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- WorldView.test.jsx`
Expected: 6 tests passing.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/WorldView.jsx frontend/src/components/WorldView.test.jsx
git commit -m "feat: wire WorldView to the live event socket and render bubbles/GM banner"
```

---

### Task 7: App — real setup-to-world flow

**Files:**
- Modify: `frontend/src/App.jsx`
- Modify: `frontend/src/App.test.jsx`

**Interfaces:**
- Consumes `ShowSetup` (existing), `WorldPage` (Task 5).
- Produces `App()` — renders `<ShowSetup onCreated={setShow} />` while no show has been created yet; once `onCreated` fires, renders `<WorldPage show={show} />` instead.

- [ ] **Step 1: Write the failing test**

Replace `frontend/src/App.test.jsx` with:

```javascript
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import App from "./App";
import WorldPage from "./pages/WorldPage";
import * as api from "./api/client";

vi.mock("./pages/WorldPage", () => ({
  default: vi.fn(() => <div data-testid="world-page-stub" />),
}));

describe("App", () => {
  it("shows ShowSetup first, then WorldPage once a show is created", async () => {
    vi.spyOn(api, "createShow").mockResolvedValue({ id: "bhram", contestants: [] });
    render(<App />);

    expect(screen.queryByTestId("world-page-stub")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /start show/i })).toBeInTheDocument();

    const names = ["The Strategist", "The Diplomat", "The Loyalist", "The Operator", "The Wildcard"];
    names.forEach((name) => fireEvent.click(screen.getByLabelText(name)));
    fireEvent.click(screen.getByRole("button", { name: /start show/i }));

    await waitFor(() => expect(screen.getByTestId("world-page-stub")).toBeInTheDocument());
    const props = WorldPage.mock.calls[WorldPage.mock.calls.length - 1][0];
    expect(props.show.id).toBe("bhram");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- App.test.jsx`
Expected: FAIL — `App` renders `WorldPage` unconditionally with no `show` prop today.

- [ ] **Step 3: Modify `frontend/src/App.jsx`**

Replace the file's contents with:

```javascript
import { useState } from "react";
import ShowSetup from "./components/ShowSetup";
import WorldPage from "./pages/WorldPage";

export default function App() {
  const [show, setShow] = useState(null);

  if (!show) {
    return <ShowSetup onCreated={setShow} />;
  }

  return <WorldPage show={show} />;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- App.test.jsx`
Expected: 1 test passing.

Then run the full frontend suite to confirm no regressions: `npm test`
Expected: every test file passes (all pre-existing suites plus every suite touched or added in this plan).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/App.jsx frontend/src/App.test.jsx
git commit -m "feat: wire App to a real ShowSetup -> WorldPage flow"
```

---

## Manual verification (not automated)

After Task 7, run the backend (`cd backend && uvicorn app.main:app`) and frontend (`cd frontend && npm run dev`) together, create a show, click "Start round", and confirm: public speech pauses the speaker with a 💬 bubble; a private message walks both participants together, turns them to face each other, and shows a 🔒 bubble over the sender only; a confession pauses the confessing character alone with a 💭 bubble; a GM ruling/announcement shows as a bottom banner without pausing anyone; uninvolved characters keep wandering throughout. This is a visual/timing check only — automated tests stop at verifying the engine's logic and component wiring, not real backend timing, per this plan's testing constraints.

## Not in this plan

Deferred per the design spec: WebSocket reconnect-on-drop handling, visualizing agent status changes (warned/eliminated) in the World view, and any interactivity beyond automatic event-driven behavior (no click-to-inspect).

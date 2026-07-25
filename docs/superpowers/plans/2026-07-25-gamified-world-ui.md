# Gamified World UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a canvas-based, top-down pixel-art "world" view in the Sheesha Ghar frontend — a single room where 5 placeholder characters wander around on a grid, in the visual style of classic overworld screens, with a minimal app shell to reach it.

**Architecture:** A plain-JS `WorldEngine` class owns the animation loop (`requestAnimationFrame`), character movement state, and canvas drawing; a thin React component (`WorldView`) only mounts/unmounts the engine and never re-renders per frame. Movement logic (tile validity, random-adjacent-tile choice, occupancy) is pure and unit-tested independently of any rendering. Placeholder pixel-art assets are generated deterministically by a committed Python/Pillow script rather than sourced externally, eliminating network and license-verification risk during implementation.

**Tech Stack:** React 18 + Vite (existing), HTML5 Canvas (no new runtime dependency), Vitest + @testing-library/react (existing), Python 3 + Pillow (one-off asset-generation script, not a frontend runtime dependency).

## Global Constraints

- The animation loop lives outside React. `WorldEngine` is a plain JS class; no per-frame state lives in React `useState`/`useReducer`.
- Tile size is fixed at 32px; the room grid is fixed at 10 tiles wide × 8 tiles tall, hardcoded in `map.js`. No map editor, no configurable layouts, in this plan.
- Characters are hardcoded placeholders (5 entries, ids `slot-1`..`slot-5`). No backend/API/WebSocket wiring in this plan — that is explicitly deferred per the design spec.
- No new npm runtime dependency for rendering (no Phaser, no canvas libraries) — hand-rolled canvas drawing only.
- Tests never touch real browser asset-loading or real animation frames: `Image`, `requestAnimationFrame`/`cancelAnimationFrame`, and `HTMLCanvasElement.prototype.getContext` are mocked in tests, consistent with this codebase's existing pattern of mocking `fetch`/`WebSocket` rather than hitting real infrastructure.
- Placeholder pixel art is generated deterministically by a committed script (`frontend/scripts/generate_placeholder_assets.py`), not downloaded from an external source, so there is no license-verification step and output is fully reproducible.

## File Structure

```
frontend/
  scripts/
    generate_placeholder_assets.py   # one-off Pillow script -> src/world/assets/*.png
  src/
    world/
      map.js                          # tile grid constants + lookups
      movement.js                      # pure movement/occupancy logic
      sprites.js                        # sprite-sheet frame lookup + image loader
      engine.js                          # WorldEngine: game loop, update, draw
      assets/
        tileset.png                       # generated placeholder tileset
        char-slot-1.png .. char-slot-5.png # generated placeholder character sheets
        CREDITS.md                          # asset provenance note
    components/
      WorldView.jsx                    # canvas + engine lifecycle (React shell)
    pages/
      WorldPage.jsx                    # placeholder character list + WorldView
    App.jsx                            # minimal view-toggle shell (setup vs world)
    main.jsx                           # Vite/React entrypoint
  index.html                          # Vite entry HTML
```

---

### Task 1: Map module

**Files:**
- Create: `frontend/src/world/map.js`
- Test: `frontend/src/world/map.test.js`

**Interfaces:**
- Produces `TILE_SIZE` (number, `32`), `TileType` (frozen object `{ FLOOR: 0, WALL: 1, PROP: 2 }`), `MAP` (10×8 grid, `MAP[y][x]`), `MAP_WIDTH` (`10`), `MAP_HEIGHT` (`8`), `isInBounds(x, y) -> bool`, `getTile(x, y) -> TileType | undefined`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/world/map.test.js`:

```javascript
import { describe, it, expect } from "vitest";
import {
  TILE_SIZE, TileType, MAP, MAP_WIDTH, MAP_HEIGHT, isInBounds, getTile,
} from "./map";

describe("map dimensions", () => {
  it("is 10 tiles wide and 8 tiles tall at 32px tiles", () => {
    expect(TILE_SIZE).toBe(32);
    expect(MAP_WIDTH).toBe(10);
    expect(MAP_HEIGHT).toBe(8);
    expect(MAP).toHaveLength(MAP_HEIGHT);
    expect(MAP[0]).toHaveLength(MAP_WIDTH);
  });
});

describe("getTile", () => {
  it("returns WALL for the border", () => {
    expect(getTile(0, 0)).toBe(TileType.WALL);
    expect(getTile(MAP_WIDTH - 1, MAP_HEIGHT - 1)).toBe(TileType.WALL);
  });

  it("returns FLOOR for an open interior tile", () => {
    expect(getTile(1, 1)).toBe(TileType.FLOOR);
  });

  it("returns PROP for the couch tiles", () => {
    expect(getTile(4, 3)).toBe(TileType.PROP);
    expect(getTile(5, 3)).toBe(TileType.PROP);
  });

  it("returns undefined outside the grid", () => {
    expect(getTile(-1, 0)).toBeUndefined();
    expect(getTile(0, -1)).toBeUndefined();
    expect(getTile(MAP_WIDTH, 0)).toBeUndefined();
    expect(getTile(0, MAP_HEIGHT)).toBeUndefined();
  });
});

describe("isInBounds", () => {
  it("is true inside the grid and false outside it", () => {
    expect(isInBounds(0, 0)).toBe(true);
    expect(isInBounds(MAP_WIDTH - 1, MAP_HEIGHT - 1)).toBe(true);
    expect(isInBounds(-1, 0)).toBe(false);
    expect(isInBounds(MAP_WIDTH, 0)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run from `frontend/`: `npm test -- map.test.js`
Expected: FAIL — `map.js` does not exist.

- [ ] **Step 3: Implement `frontend/src/world/map.js`**

```javascript
export const TILE_SIZE = 32;

export const TileType = Object.freeze({ FLOOR: 0, WALL: 1, PROP: 2 });

const W = TileType.WALL;
const F = TileType.FLOOR;
const P = TileType.PROP;

export const MAP = [
  [W, W, W, W, W, W, W, W, W, W],
  [W, F, F, F, F, F, F, F, F, W],
  [W, F, F, F, F, F, F, F, F, W],
  [W, F, F, F, P, P, F, F, F, W],
  [W, F, F, F, F, F, F, F, F, W],
  [W, F, F, F, F, F, F, F, F, W],
  [W, F, F, F, F, F, F, F, F, W],
  [W, W, W, W, W, W, W, W, W, W],
];

export const MAP_WIDTH = MAP[0].length;
export const MAP_HEIGHT = MAP.length;

export function isInBounds(x, y) {
  return x >= 0 && x < MAP_WIDTH && y >= 0 && y < MAP_HEIGHT;
}

export function getTile(x, y) {
  if (!isInBounds(x, y)) return undefined;
  return MAP[y][x];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- map.test.js`
Expected: 4 test blocks, 8 assertions, all passing.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/world/map.js frontend/src/world/map.test.js
git commit -m "feat: add world map grid and tile lookups"
```

---

### Task 2: Movement module

**Files:**
- Create: `frontend/src/world/movement.js`
- Test: `frontend/src/world/movement.test.js`

**Interfaces:**
- Consumes `TileType`, `getTile` (Task 1).
- Produces `isWalkable(x, y) -> bool`, `occupiedTiles(characters, excludingId) -> Set<string>` (each entry `"x,y"`), `pickRandomAdjacentTile(character, occupied, rng = Math.random) -> {x, y, direction} | null`. A `character` for this module's purposes is any object with `tileX`/`tileY` (and optionally `targetX`/`targetY`, `id`).

- [ ] **Step 1: Write the failing test**

Create `frontend/src/world/movement.test.js`:

```javascript
import { describe, it, expect } from "vitest";
import { isWalkable, occupiedTiles, pickRandomAdjacentTile } from "./movement";

describe("isWalkable", () => {
  it("is true for a floor tile", () => {
    expect(isWalkable(1, 1)).toBe(true);
  });

  it("is false for a wall tile", () => {
    expect(isWalkable(0, 0)).toBe(false);
  });

  it("is false for a prop tile", () => {
    expect(isWalkable(4, 3)).toBe(false);
  });

  it("is false outside the grid", () => {
    expect(isWalkable(-1, 0)).toBe(false);
  });
});

describe("occupiedTiles", () => {
  it("includes other characters' current and target tiles, excluding the given id", () => {
    const characters = [
      { id: "a", tileX: 1, tileY: 1 },
      { id: "b", tileX: 2, tileY: 2, targetX: 3, targetY: 2 },
    ];

    const occupied = occupiedTiles(characters, "a");

    expect(occupied.has("1,1")).toBe(false);
    expect(occupied.has("2,2")).toBe(true);
    expect(occupied.has("3,2")).toBe(true);
  });
});

describe("pickRandomAdjacentTile", () => {
  it("picks deterministically among walkable, unoccupied neighbors given a fixed rng", () => {
    const character = { id: "a", tileX: 1, tileY: 1 };
    // From (1,1): up=(1,0) WALL, down=(1,2) FLOOR, left=(0,1) WALL, right=(2,1) FLOOR.
    // Candidate order is [down, right].
    const occupied = new Set();

    expect(pickRandomAdjacentTile(character, occupied, () => 0)).toEqual({
      x: 1, y: 2, direction: "down",
    });
    expect(pickRandomAdjacentTile(character, occupied, () => 0.99)).toEqual({
      x: 2, y: 1, direction: "right",
    });
  });

  it("excludes occupied candidate tiles", () => {
    const character = { id: "a", tileX: 1, tileY: 1 };
    const occupied = new Set(["1,2"]); // block the down neighbor

    expect(pickRandomAdjacentTile(character, occupied, () => 0)).toEqual({
      x: 2, y: 1, direction: "right",
    });
  });

  it("returns null when every neighbor is a wall or occupied", () => {
    const character = { id: "a", tileX: 1, tileY: 1 };
    const occupied = new Set(["1,2", "2,1"]); // block both walkable neighbors

    expect(pickRandomAdjacentTile(character, occupied, () => 0)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- movement.test.js`
Expected: FAIL — `movement.js` does not exist.

- [ ] **Step 3: Implement `frontend/src/world/movement.js`**

```javascript
import { TileType, getTile } from "./map";

export function isWalkable(x, y) {
  return getTile(x, y) === TileType.FLOOR;
}

const NEIGHBOR_DELTAS = [
  { dx: 0, dy: -1, direction: "up" },
  { dx: 0, dy: 1, direction: "down" },
  { dx: -1, dy: 0, direction: "left" },
  { dx: 1, dy: 0, direction: "right" },
];

export function occupiedTiles(characters, excludingId) {
  const occupied = new Set();
  for (const character of characters) {
    if (character.id === excludingId) continue;
    occupied.add(`${character.tileX},${character.tileY}`);
    if (character.targetX !== undefined && character.targetY !== undefined) {
      occupied.add(`${character.targetX},${character.targetY}`);
    }
  }
  return occupied;
}

export function pickRandomAdjacentTile(character, occupied, rng = Math.random) {
  const candidates = NEIGHBOR_DELTAS
    .map(({ dx, dy, direction }) => ({
      x: character.tileX + dx,
      y: character.tileY + dy,
      direction,
    }))
    .filter(({ x, y }) => isWalkable(x, y) && !occupied.has(`${x},${y}`));

  if (candidates.length === 0) return null;
  const index = Math.floor(rng() * candidates.length);
  return candidates[index];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- movement.test.js`
Expected: 4 test blocks, all passing.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/world/movement.js frontend/src/world/movement.test.js
git commit -m "feat: add pure movement and occupancy logic for the world grid"
```

---

### Task 3: Placeholder pixel-art assets

**Files:**
- Create: `frontend/scripts/generate_placeholder_assets.py`
- Create (generated output, committed): `frontend/src/world/assets/tileset.png`, `frontend/src/world/assets/char-slot-1.png` .. `char-slot-5.png`, `frontend/src/world/assets/CREDITS.md`

**Interfaces:**
- Produces `tileset.png` — 96×32px, 3 tiles of 32px in a row: column 0 = floor, column 1 = wall, column 2 = prop. Matches `TileType` order from Task 1 (`FLOOR=0, WALL=1, PROP=2`).
- Produces `char-{spriteKey}.png` for `spriteKey` in `slot-1`..`slot-5` — 128×128px each, a 4×4 grid of 32px frames: row 0 = down, row 1 = left, row 2 = right, row 3 = up; 4 frames per row (column 0 = idle, columns 1-3 = walk cycle). This exact row/column contract is what `sprites.js` (Task 4) encodes.

This task has no meaningful RED/GREEN cycle — it produces static assets, not tested behavior. Instead: generate, then verify the output mechanically (file existence + exact pixel dimensions), then commit.

- [ ] **Step 1: Write the asset-generation script**

Create `frontend/scripts/generate_placeholder_assets.py`:

```python
"""Generate placeholder pixel-art assets for the World UI.

Run once from frontend/: `python3 scripts/generate_placeholder_assets.py`
Outputs deterministic, license-free placeholder PNGs to src/world/assets/.
Swap these for real art later without touching any rendering code, as
long as the replacement keeps the same tile size (32px) and the same
tileset/character-sheet grid layout documented in sprites.js.
"""
from pathlib import Path

from PIL import Image, ImageDraw

TILE_SIZE = 32
ASSETS_DIR = Path(__file__).resolve().parent.parent / "src" / "world" / "assets"

# (fill, border) per tile, in TileType order: FLOOR=0, WALL=1, PROP=2
TILE_COLORS = [
    ((214, 197, 158), (194, 177, 138)),  # floor
    ((92, 92, 102), (56, 56, 64)),        # wall
    ((150, 105, 70), (110, 75, 48)),      # prop
]

CHARACTER_COLORS = {
    "slot-1": (198, 60, 60),
    "slot-2": (60, 110, 198),
    "slot-3": (70, 168, 90),
    "slot-4": (206, 178, 52),
    "slot-5": (150, 70, 178),
}

DIRECTIONS = ["down", "left", "right", "up"]
FRAMES_PER_DIRECTION = 4

FACING_OFFSET = {
    "down": (0, 6),
    "up": (0, -6),
    "left": (-6, 0),
    "right": (6, 0),
}


def generate_tileset():
    image = Image.new("RGBA", (TILE_SIZE * len(TILE_COLORS), TILE_SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    for index, (fill, border) in enumerate(TILE_COLORS):
        x0 = index * TILE_SIZE
        box = [x0, 0, x0 + TILE_SIZE - 1, TILE_SIZE - 1]
        draw.rectangle(box, fill=fill)
        draw.rectangle(box, outline=border, width=2)
    image.save(ASSETS_DIR / "tileset.png")


def generate_character_sheet(sprite_key, color):
    width = TILE_SIZE * FRAMES_PER_DIRECTION
    height = TILE_SIZE * len(DIRECTIONS)
    image = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)

    for row, direction in enumerate(DIRECTIONS):
        fx, fy = FACING_OFFSET[direction]
        for frame in range(FRAMES_PER_DIRECTION):
            cx = frame * TILE_SIZE + TILE_SIZE // 2
            cy = row * TILE_SIZE + TILE_SIZE // 2
            bob = 2 if frame % 2 == 1 else 0
            radius = 10
            draw.ellipse(
                [cx - radius, cy - radius + bob, cx + radius, cy + radius + bob],
                fill=color,
                outline=(0, 0, 0, 255),
                width=2,
            )
            nose_x, nose_y = cx + fx, cy + fy + bob
            draw.ellipse(
                [nose_x - 3, nose_y - 3, nose_x + 3, nose_y + 3],
                fill=(0, 0, 0, 255),
            )

    image.save(ASSETS_DIR / f"char-{sprite_key}.png")


def main():
    ASSETS_DIR.mkdir(parents=True, exist_ok=True)
    generate_tileset()
    for sprite_key, color in CHARACTER_COLORS.items():
        generate_character_sheet(sprite_key, color)
    print(f"Wrote tileset.png and {len(CHARACTER_COLORS)} character sheets to {ASSETS_DIR}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Run the script**

Run from `frontend/`: `python3 scripts/generate_placeholder_assets.py`
Expected output: `Wrote tileset.png and 5 character sheets to .../frontend/src/world/assets`

- [ ] **Step 3: Verify the generated assets mechanically**

Run from `frontend/`:

```bash
python3 -c "
from PIL import Image
from pathlib import Path

assets = Path('src/world/assets')
tileset = Image.open(assets / 'tileset.png')
assert tileset.size == (96, 32), tileset.size

for key in ['slot-1', 'slot-2', 'slot-3', 'slot-4', 'slot-5']:
    sheet = Image.open(assets / f'char-{key}.png')
    assert sheet.size == (128, 128), (key, sheet.size)

print('all placeholder assets verified')
"
```

Expected: `all placeholder assets verified`

- [ ] **Step 4: Write the attribution note**

Create `frontend/src/world/assets/CREDITS.md`:

```markdown
# World UI placeholder assets

`tileset.png` and `char-slot-*.png` in this directory are generated
programmatically by `frontend/scripts/generate_placeholder_assets.py` —
simple solid-colored shapes, not derived from any existing artwork. No
external license applies; they exist to validate the rendering and
movement mechanics and are expected to be replaced by real pixel art
later. Any replacement must keep the same tile size (32px) and the same
tileset/character-sheet grid layout described in `sprites.js`.
```

- [ ] **Step 5: Commit**

```bash
git add frontend/scripts/generate_placeholder_assets.py frontend/src/world/assets/
git commit -m "feat: generate placeholder pixel-art tileset and character sheets"
```

---

### Task 4: Sprite frame lookup

**Files:**
- Create: `frontend/src/world/sprites.js`
- Test: `frontend/src/world/sprites.test.js`

**Interfaces:**
- Consumes `TILE_SIZE` (Task 1).
- Produces `DIRECTIONS` (`["down", "left", "right", "up"]`), `FRAMES_PER_DIRECTION` (`4`), `tileSourceRect(tileType) -> {sx, sy, sw, sh}`, `characterSourceRect(direction, frame) -> {sx, sy, sw, sh}` (throws for an unknown direction; wraps out-of-range frame indices), `loadImage(src) -> Promise<Image>` (rejects on load failure).

- [ ] **Step 1: Write the failing test**

Create `frontend/src/world/sprites.test.js`:

```javascript
import { describe, it, expect, beforeEach } from "vitest";
import { tileSourceRect, characterSourceRect, loadImage } from "./sprites";
import { TILE_SIZE } from "./map";

describe("tileSourceRect", () => {
  it("returns the source rectangle for a tile's column index", () => {
    expect(tileSourceRect(0)).toEqual({ sx: 0, sy: 0, sw: TILE_SIZE, sh: TILE_SIZE });
    expect(tileSourceRect(2)).toEqual({
      sx: TILE_SIZE * 2, sy: 0, sw: TILE_SIZE, sh: TILE_SIZE,
    });
  });
});

describe("characterSourceRect", () => {
  it("maps direction to row and frame to column", () => {
    expect(characterSourceRect("down", 0)).toEqual({
      sx: 0, sy: 0, sw: TILE_SIZE, sh: TILE_SIZE,
    });
    expect(characterSourceRect("up", 2)).toEqual({
      sx: TILE_SIZE * 2, sy: TILE_SIZE * 3, sw: TILE_SIZE, sh: TILE_SIZE,
    });
  });

  it("wraps an out-of-range frame index back into 0-3", () => {
    expect(characterSourceRect("left", 5)).toEqual(characterSourceRect("left", 1));
  });

  it("throws for an unknown direction", () => {
    expect(() => characterSourceRect("sideways", 0)).toThrow("Unknown direction: sideways");
  });
});

describe("loadImage", () => {
  beforeEach(() => {
    global.Image = class {
      set src(_value) {
        setTimeout(() => this.onload && this.onload(), 0);
      }
    };
  });

  it("resolves with the image once it loads", async () => {
    const image = await loadImage("tileset.png");
    expect(image).toBeInstanceOf(global.Image);
  });

  it("rejects when the image fails to load", async () => {
    global.Image = class {
      set src(_value) {
        setTimeout(() => this.onerror && this.onerror(), 0);
      }
    };
    await expect(loadImage("missing.png")).rejects.toThrow("Failed to load image: missing.png");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- sprites.test.js`
Expected: FAIL — `sprites.js` does not exist.

- [ ] **Step 3: Implement `frontend/src/world/sprites.js`**

```javascript
import { TILE_SIZE } from "./map";

export const DIRECTIONS = ["down", "left", "right", "up"];
export const FRAMES_PER_DIRECTION = 4;

export function tileSourceRect(tileType) {
  return { sx: tileType * TILE_SIZE, sy: 0, sw: TILE_SIZE, sh: TILE_SIZE };
}

export function characterSourceRect(direction, frame) {
  const row = DIRECTIONS.indexOf(direction);
  if (row === -1) {
    throw new Error(`Unknown direction: ${direction}`);
  }
  const col = ((frame % FRAMES_PER_DIRECTION) + FRAMES_PER_DIRECTION) % FRAMES_PER_DIRECTION;
  return { sx: col * TILE_SIZE, sy: row * TILE_SIZE, sw: TILE_SIZE, sh: TILE_SIZE };
}

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Failed to load image: ${src}`));
    image.src = src;
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- sprites.test.js`
Expected: 6 tests passing.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/world/sprites.js frontend/src/world/sprites.test.js
git commit -m "feat: add sprite-sheet frame lookup and image loader"
```

---

### Task 5: World engine

**Files:**
- Create: `frontend/src/world/engine.js`
- Test: `frontend/src/world/engine.test.js`

**Interfaces:**
- Consumes `MAP`, `MAP_WIDTH`, `MAP_HEIGHT`, `TILE_SIZE` (Task 1), `pickRandomAdjacentTile`, `occupiedTiles` (Task 2), `tileSourceRect`, `characterSourceRect` (Task 4).
- Produces `randomPause(rng = Math.random) -> number` (milliseconds, between 800 and 2000) and class `WorldEngine`:
  - `new WorldEngine(ctx, characters, images, options = {})` — `images` is `{ tileset, characters: { [spriteKey]: Image } }`; `options` may override `rng`, `requestFrame`, `cancelFrame` (all default to the real browser globals) for testability.
  - `.start()` — begins the `requestAnimationFrame` loop.
  - `.stop()` — cancels it.
  - `.update(deltaMs)` — advances all characters' walk/pause state one tick; exposed directly for testing without a real animation frame.
  - `.draw()` — clears the canvas, draws every map tile, then draws every character at its interpolated pixel position; exposed directly for testing against a fake context.
  - `.characters` — the engine's internal per-character state array (each entry: `id, name, spriteKey, tileX, tileY, direction, moving, walkProgress, targetX, targetY, pauseRemainingMs`), readable for test assertions.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/world/engine.test.js`:

```javascript
import { describe, it, expect, vi } from "vitest";
import { WorldEngine, randomPause } from "./engine";
import { MAP_WIDTH, MAP_HEIGHT } from "./map";

function fakeContext() {
  return { clearRect: vi.fn(), drawImage: vi.fn() };
}

function fakeImages() {
  return { tileset: {}, characters: { "slot-1": {} } };
}

function baseCharacter(overrides = {}) {
  return {
    id: "slot-1", name: "Housemate 1", spriteKey: "slot-1", tileX: 1, tileY: 1, ...overrides,
  };
}

describe("randomPause", () => {
  it("stays within the configured pause bounds", () => {
    expect(randomPause(() => 0)).toBe(800);
    expect(randomPause(() => 1)).toBe(2000);
  });
});

describe("WorldEngine.update", () => {
  it("starts a walk once the pause timer elapses and a valid tile exists", () => {
    const engine = new WorldEngine(fakeContext(), [baseCharacter()], fakeImages(), { rng: () => 0 });
    engine.characters[0].pauseRemainingMs = 0;

    engine.update(16);

    const character = engine.characters[0];
    expect(character.moving).toBe(true);
    expect([character.targetX, character.targetY]).not.toEqual([character.tileX, character.tileY]);
  });

  it("advances walk progress and snaps into place once a walk completes", () => {
    const engine = new WorldEngine(fakeContext(), [baseCharacter()], fakeImages(), { rng: () => 0 });
    engine.characters[0].pauseRemainingMs = 0;
    engine.update(16);
    const target = { x: engine.characters[0].targetX, y: engine.characters[0].targetY };

    engine.update(1000);

    const character = engine.characters[0];
    expect(character.moving).toBe(false);
    expect(character.tileX).toBe(target.x);
    expect(character.tileY).toBe(target.y);
  });

  it("re-arms the pause timer when every neighbor is blocked or a wall", () => {
    const mover = baseCharacter({ tileX: 1, tileY: 1 });
    const blockerA = baseCharacter({ id: "blocker-a", tileX: 1, tileY: 2 });
    const blockerB = baseCharacter({ id: "blocker-b", tileX: 2, tileY: 1 });
    const engine = new WorldEngine(
      fakeContext(), [mover, blockerA, blockerB], fakeImages(), { rng: () => 0 },
    );
    engine.characters[0].pauseRemainingMs = 0;

    engine.update(16);

    expect(engine.characters[0].moving).toBe(false);
    expect(engine.characters[0].pauseRemainingMs).toBeGreaterThan(0);
  });

  it("does nothing to a character still waiting out its pause", () => {
    const engine = new WorldEngine(fakeContext(), [baseCharacter()], fakeImages(), { rng: () => 0 });
    engine.characters[0].pauseRemainingMs = 5000;

    engine.update(16);

    expect(engine.characters[0].moving).toBe(false);
    expect(engine.characters[0].pauseRemainingMs).toBe(4984);
  });
});

describe("WorldEngine.draw", () => {
  it("clears the canvas once and draws every tile plus every character", () => {
    const ctx = fakeContext();
    const engine = new WorldEngine(ctx, [baseCharacter()], fakeImages());

    engine.draw();

    expect(ctx.clearRect).toHaveBeenCalledTimes(1);
    expect(ctx.drawImage).toHaveBeenCalledTimes(MAP_WIDTH * MAP_HEIGHT + 1);
  });
});

describe("WorldEngine start/stop", () => {
  it("requests a frame on start and cancels it on stop", () => {
    const requestFrame = vi.fn(() => 42);
    const cancelFrame = vi.fn();
    const engine = new WorldEngine(fakeContext(), [baseCharacter()], fakeImages(), {
      requestFrame, cancelFrame,
    });

    engine.start();
    expect(requestFrame).toHaveBeenCalledTimes(1);

    engine.stop();
    expect(cancelFrame).toHaveBeenCalledWith(42);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- engine.test.js`
Expected: FAIL — `engine.js` does not exist.

- [ ] **Step 3: Implement `frontend/src/world/engine.js`**

```javascript
import { MAP, MAP_WIDTH, MAP_HEIGHT, TILE_SIZE } from "./map";
import { pickRandomAdjacentTile, occupiedTiles } from "./movement";
import { tileSourceRect, characterSourceRect } from "./sprites";

const WALK_DURATION_MS = 350;
const MIN_PAUSE_MS = 800;
const MAX_PAUSE_MS = 2000;

export function randomPause(rng = Math.random) {
  return MIN_PAUSE_MS + rng() * (MAX_PAUSE_MS - MIN_PAUSE_MS);
}

export class WorldEngine {
  constructor(ctx, characters, images, options = {}) {
    this.ctx = ctx;
    this.images = images;
    this.rng = options.rng || Math.random;
    this.requestFrame = options.requestFrame || ((cb) => requestAnimationFrame(cb));
    this.cancelFrame = options.cancelFrame || ((id) => cancelAnimationFrame(id));
    this.rafId = null;
    this.lastTimestamp = null;

    this.characters = characters.map((character) => ({
      ...character,
      direction: character.direction || "down",
      moving: false,
      walkProgress: 0,
      targetX: undefined,
      targetY: undefined,
      pauseRemainingMs: randomPause(this.rng),
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

  update(deltaMs) {
    for (const character of this.characters) {
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
      const toX = character.moving ? character.targetX : character.tileX;
      const toY = character.moving ? character.targetY : character.tileY;
      const progress = character.moving ? character.walkProgress : 0;
      const pixelX = (character.tileX + (toX - character.tileX) * progress) * TILE_SIZE;
      const pixelY = (character.tileY + (toY - character.tileY) * progress) * TILE_SIZE;

      const frame = character.moving ? Math.floor(progress * 4) : 0;
      const { sx, sy, sw, sh } = characterSourceRect(character.direction, frame);
      const sheet = this.images.characters[character.spriteKey];
      ctx.drawImage(sheet, sx, sy, sw, sh, pixelX, pixelY, TILE_SIZE, TILE_SIZE);
    }
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- engine.test.js`
Expected: 6 tests passing.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/world/engine.js frontend/src/world/engine.test.js
git commit -m "feat: add world engine with movement update loop and canvas drawing"
```

---

### Task 6: WorldView component

**Files:**
- Create: `frontend/src/components/WorldView.jsx`
- Test: `frontend/src/components/WorldView.test.jsx`

**Interfaces:**
- Consumes `MAP_WIDTH`, `MAP_HEIGHT`, `TILE_SIZE` (Task 1), `loadImage` (Task 4), `WorldEngine` (Task 5).
- Produces `WorldView({ characters })` — renders a `<canvas data-testid="world-canvas">` sized `MAP_WIDTH*TILE_SIZE` × `MAP_HEIGHT*TILE_SIZE`; on mount, loads the tileset and each unique `spriteKey`'s character sheet, then constructs and starts a `WorldEngine`; on unmount, stops it. On any asset-load failure, renders `<p role="alert">World assets failed to load: {message}</p>` instead of the canvas.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/WorldView.test.jsx`:

```javascript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import WorldView from "./WorldView";
import { WorldEngine } from "../world/engine";
import { loadImage } from "../world/sprites";
import { MAP_WIDTH, MAP_HEIGHT, TILE_SIZE } from "../world/map";

vi.mock("../world/engine", () => ({
  WorldEngine: vi.fn().mockImplementation(() => ({ start: vi.fn(), stop: vi.fn() })),
}));

vi.mock("../world/sprites", () => ({
  loadImage: vi.fn(),
}));

const characters = [
  { id: "slot-1", name: "Housemate 1", spriteKey: "slot-1", tileX: 1, tileY: 1 },
];

beforeEach(() => {
  vi.clearAllMocks();
  loadImage.mockResolvedValue({});
  HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({});
});

describe("WorldView", () => {
  it("renders a canvas sized to the map", () => {
    render(<WorldView characters={characters} />);
    const canvas = screen.getByTestId("world-canvas");
    expect(canvas.width).toBe(MAP_WIDTH * TILE_SIZE);
    expect(canvas.height).toBe(MAP_HEIGHT * TILE_SIZE);
  });

  it("starts the engine once assets load", async () => {
    render(<WorldView characters={characters} />);
    await waitFor(() => expect(WorldEngine).toHaveBeenCalledTimes(1));
    const instance = WorldEngine.mock.results[0].value;
    expect(instance.start).toHaveBeenCalledTimes(1);
  });

  it("stops the engine on unmount", async () => {
    const { unmount } = render(<WorldView characters={characters} />);
    await waitFor(() => expect(WorldEngine).toHaveBeenCalledTimes(1));
    const instance = WorldEngine.mock.results[0].value;

    unmount();

    expect(instance.stop).toHaveBeenCalledTimes(1);
  });

  it("shows a fallback message when assets fail to load", async () => {
    loadImage.mockRejectedValue(new Error("404"));
    render(<WorldView characters={characters} />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("alert").textContent).toContain("404");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- WorldView.test.jsx`
Expected: FAIL — `WorldView.jsx` does not exist.

- [ ] **Step 3: Implement `frontend/src/components/WorldView.jsx`**

```javascript
import { useEffect, useRef, useState } from "react";
import { MAP_WIDTH, MAP_HEIGHT, TILE_SIZE } from "../world/map";
import { loadImage } from "../world/sprites";
import { WorldEngine } from "../world/engine";

export default function WorldView({ characters }) {
  const canvasRef = useRef(null);
  const [loadError, setLoadError] = useState(null);

  useEffect(() => {
    let engine;
    let cancelled = false;

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
        engine = new WorldEngine(ctx, characters, { tileset, characters: characterSheets });
        engine.start();
      } catch (error) {
        if (!cancelled) setLoadError(error.message);
      }
    }

    setup();

    return () => {
      cancelled = true;
      if (engine) engine.stop();
    };
  }, [characters]);

  if (loadError) {
    return <p role="alert">World assets failed to load: {loadError}</p>;
  }

  return (
    <canvas
      ref={canvasRef}
      width={MAP_WIDTH * TILE_SIZE}
      height={MAP_HEIGHT * TILE_SIZE}
      data-testid="world-canvas"
    />
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- WorldView.test.jsx`
Expected: 4 tests passing.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/WorldView.jsx frontend/src/components/WorldView.test.jsx
git commit -m "feat: add WorldView canvas component with engine lifecycle"
```

---

### Task 7: WorldPage

**Files:**
- Create: `frontend/src/pages/WorldPage.jsx`
- Test: `frontend/src/pages/WorldPage.test.jsx`

**Interfaces:**
- Consumes `WorldView` (Task 6).
- Produces `PLACEHOLDER_CHARACTERS` (array of 5 `{id, name, spriteKey, tileX, tileY}`, ids `slot-1`..`slot-5`, matching Task 3's generated `char-slot-*.png` sprite keys) and `WorldPage()` — renders a heading and `<WorldView characters={PLACEHOLDER_CHARACTERS} />`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/pages/WorldPage.test.jsx`:

```javascript
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import WorldPage, { PLACEHOLDER_CHARACTERS } from "./WorldPage";
import WorldView from "../components/WorldView";

vi.mock("../components/WorldView", () => ({
  default: vi.fn(() => <div data-testid="world-view-stub" />),
}));

describe("WorldPage", () => {
  it("renders WorldView with the placeholder character list", () => {
    render(<WorldPage />);
    expect(screen.getByTestId("world-view-stub")).toBeInTheDocument();
    const props = WorldView.mock.calls[0][0];
    expect(props.characters).toBe(PLACEHOLDER_CHARACTERS);
  });

  it("has exactly five placeholder characters with unique ids and sprite keys", () => {
    expect(PLACEHOLDER_CHARACTERS).toHaveLength(5);
    expect(new Set(PLACEHOLDER_CHARACTERS.map((c) => c.id)).size).toBe(5);
    expect(new Set(PLACEHOLDER_CHARACTERS.map((c) => c.spriteKey)).size).toBe(5);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- WorldPage.test.jsx`
Expected: FAIL — `WorldPage.jsx` does not exist.

- [ ] **Step 3: Implement `frontend/src/pages/WorldPage.jsx`**

```javascript
import WorldView from "../components/WorldView";

export const PLACEHOLDER_CHARACTERS = [
  { id: "slot-1", name: "Housemate 1", spriteKey: "slot-1", tileX: 2, tileY: 2 },
  { id: "slot-2", name: "Housemate 2", spriteKey: "slot-2", tileX: 4, tileY: 2 },
  { id: "slot-3", name: "Housemate 3", spriteKey: "slot-3", tileX: 6, tileY: 2 },
  { id: "slot-4", name: "Housemate 4", spriteKey: "slot-4", tileX: 3, tileY: 5 },
  { id: "slot-5", name: "Housemate 5", spriteKey: "slot-5", tileX: 6, tileY: 5 },
];

export default function WorldPage() {
  return (
    <div>
      <h1>The House</h1>
      <WorldView characters={PLACEHOLDER_CHARACTERS} />
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- WorldPage.test.jsx`
Expected: 2 tests passing.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/WorldPage.jsx frontend/src/pages/WorldPage.test.jsx
git commit -m "feat: add WorldPage with five placeholder housemates"
```

---

### Task 8: App shell and entrypoint

**Files:**
- Create: `frontend/src/App.jsx`, `frontend/src/App.test.jsx`, `frontend/src/main.jsx`, `frontend/index.html`

**Interfaces:**
- Consumes `WorldPage` (Task 7).
- Produces `App()` — a minimal view toggle (`"setup" | "world"`, default `"setup"`) with two buttons ("Show Setup", "View World"), each disabled when it's the active view; renders a setup placeholder paragraph or `<WorldPage />` accordingly. Produces `frontend/main.jsx` (mounts `<App />` into `#root`) and `frontend/index.html` (Vite entry point). `main.jsx`/`index.html` are wiring with no dedicated test, consistent with this codebase's existing `backend/app/main.py` pattern.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/App.test.jsx`:

```javascript
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import App from "./App";

vi.mock("./pages/WorldPage", () => ({
  default: vi.fn(() => <div data-testid="world-page-stub" />),
}));

describe("App", () => {
  it("shows the setup placeholder by default", () => {
    render(<App />);
    expect(screen.getByText(/show setup flow goes here/i)).toBeInTheDocument();
    expect(screen.queryByTestId("world-page-stub")).not.toBeInTheDocument();
  });

  it("switches to the world view and back", () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /view world/i }));
    expect(screen.getByTestId("world-page-stub")).toBeInTheDocument();
    expect(screen.queryByText(/show setup flow goes here/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /show setup/i }));
    expect(screen.getByText(/show setup flow goes here/i)).toBeInTheDocument();
  });

  it("disables the button for the currently active view", () => {
    render(<App />);
    expect(screen.getByRole("button", { name: /show setup/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /view world/i })).not.toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: /view world/i }));
    expect(screen.getByRole("button", { name: /view world/i })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- App.test.jsx`
Expected: FAIL — `App.jsx` does not exist.

- [ ] **Step 3: Implement `frontend/src/App.jsx`, `frontend/src/main.jsx`, `frontend/index.html`**

Create `frontend/src/App.jsx`:

```javascript
import { useState } from "react";
import WorldPage from "./pages/WorldPage";

export default function App() {
  const [view, setView] = useState("setup");

  return (
    <div>
      <nav>
        <button onClick={() => setView("setup")} disabled={view === "setup"}>
          Show Setup
        </button>
        <button onClick={() => setView("world")} disabled={view === "world"}>
          View World
        </button>
      </nav>

      {view === "setup" && <p>Show setup flow goes here.</p>}
      {view === "world" && <WorldPage />}
    </div>
  );
}
```

Create `frontend/src/main.jsx`:

```javascript
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

Create `frontend/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Sheesha Ghar</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- App.test.jsx`
Expected: 3 tests passing.

Then run the full frontend suite to confirm no regressions: `npm test`
Expected: all suites passing (Task 1-8's new tests plus every existing test from the earlier Sheesha Ghar frontend tasks).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/App.jsx frontend/src/App.test.jsx frontend/src/main.jsx frontend/index.html
git commit -m "feat: add minimal app shell with setup/world view toggle"
```

---

## Manual verification (not automated)

After Task 8, run `npm run dev` from `frontend/` and open the served URL: click "View World" and confirm 5 colored circular sprites appear on the tile grid and wander around at intervals, each bouncing off walls/the couch prop and never overlapping. This is a visual check only — automated tests stop at verifying the engine's logic and lifecycle, not pixel output, per the design spec.

## Not in this plan

Deferred per the design spec: wiring `WorldPage`'s character list to the backend's real 5 agents, multiple rooms/room transitions, any character interactivity (click-to-inspect), and a real routing setup replacing `App.jsx`'s throwaway view toggle.

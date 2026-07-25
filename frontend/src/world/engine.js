import { MAP, MAP_WIDTH, MAP_HEIGHT, TILE_SIZE } from "./map";
import { pickRandomAdjacentTile, occupiedTiles } from "./movement";
import { tileSourceRect, characterSourceRect, FRAMES_PER_DIRECTION } from "./sprites";

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

      const frame = character.moving ? Math.floor(progress * FRAMES_PER_DIRECTION) : 0;
      const { sx, sy, sw, sh } = characterSourceRect(character.direction, frame);
      const sheet = this.images.characters[character.spriteKey];
      ctx.drawImage(sheet, sx, sy, sw, sh, pixelX, pixelY, TILE_SIZE, TILE_SIZE);
    }
  }
}

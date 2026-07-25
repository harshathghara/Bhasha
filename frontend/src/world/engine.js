import { MAP, MAP_WIDTH, MAP_HEIGHT, TILE_SIZE } from "./map";
import { pickRandomAdjacentTile, occupiedTiles } from "./movement";
import { tileSourceRect, characterSourceRect, FRAMES_PER_DIRECTION } from "./sprites";
import { mapEvent } from "./eventMapping";
import { findPathBetween } from "./pathfinding";
import {
  INTERACTION_DURATION_MS,
  isCommandReady,
  startCommand,
  advanceWalkingToInteract,
  advanceInteracting,
} from "./interactions";

// Tiles are now half the physical size they used to be (map.js doubled grid
// resolution), so each tile-step covers half the real distance — halved to
// keep the same perceived walking speed across the room.
const WALK_DURATION_MS = 175;
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

    if (command.kind === "private") {
      const sender = this.characters.find((c) => c.id === command.senderId);
      const recipient = this.characters.find((c) => c.id === command.recipientId);
      if (!sender || !recipient) return;
      sender.queue.push(command);
      recipient.queue.push(command);
      return;
    }

    const sender = this.characters.find((c) => c.id === command.senderId);
    if (sender) sender.queue.push(command);
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
        startCommand(character, charactersById, findPathBetween);
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
    const dialogueBusy = this.characters.some((character) => (
      character.queue.length > 0
      || character.mode === "interacting"
      || character.mode === "walking-to-interact"
    ));
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
      dialogueBusy,
    };
  }
}

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

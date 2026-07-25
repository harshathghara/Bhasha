import { describe, it, expect } from "vitest";
import {
  INTERACTION_DURATION_MS,
  isCommandReady,
  startCommand,
  buildMeetPlan,
  advanceWalkingToInteract,
  advanceInteracting,
  directionToward,
} from "./interactions";
import { findPathBetween } from "./pathfinding";

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

describe("buildMeetPlan", () => {
  it("returns empty paths for both sides when already adjacent", () => {
    const command = { id: 1, kind: "private", senderId: "a", recipientId: "b" };
    const sender = baseCharacter({ id: "a", tileX: 1, tileY: 1 });
    const recipient = baseCharacter({ id: "b", tileX: 2, tileY: 1 });
    const byId = new Map([["a", sender], ["b", recipient]]);

    const plan = buildMeetPlan(command, byId, findPathBetween);

    expect(plan).toEqual({ senderPath: [], recipientPath: [] });
  });

  it("splits a shared route so both halves land on adjacent tiles", () => {
    const command = { id: 1, kind: "private", senderId: "a", recipientId: "b" };
    const sender = baseCharacter({ id: "a", tileX: 1, tileY: 1 });
    const recipient = baseCharacter({ id: "b", tileX: 6, tileY: 1 });
    const byId = new Map([["a", sender], ["b", recipient]]);

    const plan = buildMeetPlan(command, byId, findPathBetween);

    expect(plan.senderPath.length).toBeGreaterThan(0);
    expect(plan.recipientPath.length).toBeGreaterThan(0);

    const senderEnd = plan.senderPath[plan.senderPath.length - 1];
    const recipientEnd = plan.recipientPath[plan.recipientPath.length - 1];
    const dist = Math.abs(senderEnd.x - recipientEnd.x) + Math.abs(senderEnd.y - recipientEnd.y);
    expect(dist).toBe(1);
  });

  it("returns null paths when no route exists", () => {
    const command = { id: 1, kind: "private", senderId: "a", recipientId: "b" };
    const sender = baseCharacter({ id: "a", tileX: 1, tileY: 1 });
    const recipient = baseCharacter({ id: "b", tileX: 2, tileY: 1 });
    const byId = new Map([["a", sender], ["b", recipient]]);

    const plan = buildMeetPlan(command, byId, () => null);

    expect(plan).toEqual({ senderPath: null, recipientPath: null });
  });
});

describe("buildMeetPlan crowd avoidance", () => {
  function manhattan(a, b) {
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  }

  it("defaults to the natural midpoint when no one else is interacting", () => {
    const command = { id: 1, kind: "private", senderId: "a", recipientId: "b" };
    const sender = baseCharacter({ id: "a", tileX: 1, tileY: 1 });
    const recipient = baseCharacter({ id: "b", tileX: 8, tileY: 1 });
    const byId = new Map([["a", sender], ["b", recipient]]);

    const plan = buildMeetPlan(command, byId, findPathBetween);

    const senderEnd = plan.senderPath[plan.senderPath.length - 1];
    const recipientEnd = plan.recipientPath[plan.recipientPath.length - 1];
    expect(senderEnd).toEqual({ x: 5, y: 1 });
    expect(recipientEnd).toEqual({ x: 6, y: 1 });
  });

  it("steers the meeting point away from another pair already interacting near the midpoint", () => {
    const command = { id: 1, kind: "private", senderId: "a", recipientId: "b" };
    const sender = baseCharacter({ id: "a", tileX: 1, tileY: 1 });
    const recipient = baseCharacter({ id: "b", tileX: 8, tileY: 1 });
    const busyOne = baseCharacter({ id: "c", tileX: 5, tileY: 2, mode: "interacting" });
    const busyTwo = baseCharacter({ id: "d", tileX: 6, tileY: 2, mode: "interacting" });
    const byId = new Map([
      ["a", sender], ["b", recipient], ["c", busyOne], ["d", busyTwo],
    ]);

    const plan = buildMeetPlan(command, byId, findPathBetween);

    const senderEnd = plan.senderPath.length > 0
      ? plan.senderPath[plan.senderPath.length - 1] : { x: sender.tileX, y: sender.tileY };
    const recipientEnd = plan.recipientPath.length > 0
      ? plan.recipientPath[plan.recipientPath.length - 1] : { x: recipient.tileX, y: recipient.tileY };
    const distFromCrowd = Math.min(
      manhattan(senderEnd, { x: 5, y: 2 }), manhattan(senderEnd, { x: 6, y: 2 }),
      manhattan(recipientEnd, { x: 5, y: 2 }), manhattan(recipientEnd, { x: 6, y: 2 }),
    );
    // The untouched natural midpoint (5,1)/(6,1) would only be 1 tile from the crowd.
    expect(distFromCrowd).toBeGreaterThan(1);
  });

  it("ignores characters who are only wandering, not actively interacting", () => {
    const command = { id: 1, kind: "private", senderId: "a", recipientId: "b" };
    const sender = baseCharacter({ id: "a", tileX: 1, tileY: 1 });
    const recipient = baseCharacter({ id: "b", tileX: 8, tileY: 1 });
    const wanderer = baseCharacter({ id: "c", tileX: 5, tileY: 2, mode: "wander" });
    const byId = new Map([["a", sender], ["b", recipient], ["c", wanderer]]);

    const plan = buildMeetPlan(command, byId, findPathBetween);

    const senderEnd = plan.senderPath[plan.senderPath.length - 1];
    expect(senderEnd).toEqual({ x: 5, y: 1 });
  });
});

describe("startCommand", () => {
  it("begins interacting immediately for a public command, facing unchanged", () => {
    const command = { id: 1, kind: "public", senderId: "a", text: "hi" };
    const character = baseCharacter({ queue: [command], direction: "left" });

    startCommand(character, new Map([["a", character]]), () => null);

    expect(character.mode).toBe("interacting");
    expect(character.direction).toBe("left");
    expect(character.interactingRemainingMs).toBe(INTERACTION_DURATION_MS);
  });

  it("walks the sender along its half of the shared route toward the recipient", () => {
    const command = { id: 1, kind: "private", senderId: "a", recipientId: "b", text: "psst" };
    const sender = baseCharacter({ id: "a", tileX: 1, tileY: 1, queue: [command] });
    const recipient = baseCharacter({ id: "b", tileX: 5, tileY: 1 });
    const byId = new Map([["a", sender], ["b", recipient]]);

    startCommand(sender, byId, findPathBetween);

    expect(sender.mode).toBe("walking-to-interact");
    expect(sender.path.length).toBeGreaterThan(0);
  });

  it("caches the meet plan on the command so both sides use the same shared route", () => {
    const command = { id: 1, kind: "private", senderId: "a", recipientId: "b", text: "psst" };
    const sender = baseCharacter({ id: "a", tileX: 1, tileY: 1, queue: [command] });
    const recipient = baseCharacter({ id: "b", tileX: 6, tileY: 1, queue: [command] });
    const byId = new Map([["a", sender], ["b", recipient]]);

    startCommand(sender, byId, findPathBetween);
    const planAfterSender = command.meetPlan;
    startCommand(recipient, byId, () => {
      throw new Error("should not recompute the route once cached");
    });

    expect(command.meetPlan).toBe(planAfterSender);
    expect(recipient.mode).toBe("walking-to-interact");
    expect(recipient.path.length).toBeGreaterThan(0);
  });

  it("skips walking and interacts in place when already adjacent", () => {
    const command = { id: 1, kind: "private", senderId: "a", recipientId: "b", text: "psst" };
    const sender = baseCharacter({ id: "a", tileX: 1, tileY: 1, queue: [command] });
    const recipient = baseCharacter({ id: "b", tileX: 2, tileY: 1 });
    const byId = new Map([["a", sender], ["b", recipient]]);

    startCommand(sender, byId, findPathBetween);

    expect(sender.mode).toBe("interacting");
    expect(sender.direction).toBe("right");
  });

  it("falls back to interacting in place when no route exists", () => {
    const command = { id: 1, kind: "private", senderId: "a", recipientId: "b", text: "psst" };
    const sender = baseCharacter({ id: "a", tileX: 1, tileY: 1, queue: [command] });
    const recipient = baseCharacter({ id: "b", tileX: 8, tileY: 6 });
    const byId = new Map([["a", sender], ["b", recipient]]);

    startCommand(sender, byId, () => null);

    expect(sender.mode).toBe("interacting");
  });
});

describe("full convergence with the real pathfinder", () => {
  it("walks both participants to tiles adjacent to each other, not just their partner's stale starting snapshot", () => {
    const command = { id: 1, kind: "private", senderId: "a", recipientId: "b", text: "psst" };
    const sender = baseCharacter({ id: "a", tileX: 1, tileY: 1, queue: [command] });
    const recipient = baseCharacter({ id: "b", tileX: 8, tileY: 6, queue: [command] });
    const byId = new Map([["a", sender], ["b", recipient]]);

    startCommand(sender, byId, findPathBetween);
    startCommand(recipient, byId, findPathBetween);

    function runToCompletion(character) {
      let ticks = 0;
      while (character.mode === "walking-to-interact" && ticks < 200) {
        advanceWalkingToInteract(character, 100, byId);
        ticks += 1;
      }
    }

    runToCompletion(sender);
    runToCompletion(recipient);

    expect(sender.mode).toBe("interacting");
    expect(recipient.mode).toBe("interacting");
    const dist = Math.abs(sender.tileX - recipient.tileX) + Math.abs(sender.tileY - recipient.tileY);
    expect(dist).toBe(1);
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

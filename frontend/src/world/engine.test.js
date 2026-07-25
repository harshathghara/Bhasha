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

  it("skips a private event when the recipient is unknown, leaving both queues empty", () => {
    const sender = baseCharacter({ id: "a" });
    const other = baseCharacter({ id: "b", tileX: 5, tileY: 5 });
    const engine = new WorldEngine(fakeContext(), [sender, other], fakeImages());

    engine.handleEvent({
      seq: 1, sender_id: "a", text: "psst", kind: "agent_action",
      visibility: "private", recipients: ["missing"],
    });

    expect(engine.characters[0].queue).toHaveLength(0);
    expect(engine.characters[1].queue).toHaveLength(0);
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
    expect(snapshot.dialogueBusy).toBe(true);
  });

  it("reports dialogueBusy false when no speech is queued or playing", () => {
    const onFrame = vi.fn();
    const engine = new WorldEngine(fakeContext(), [baseCharacter()], fakeImages(), {
      rng: () => 0, onFrame,
    });
    engine.draw();
    const snapshot = onFrame.mock.calls[onFrame.mock.calls.length - 1][0];
    expect(snapshot.dialogueBusy).toBe(false);
  });
});

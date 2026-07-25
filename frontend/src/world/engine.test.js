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

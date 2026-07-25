import { describe, it, expect, beforeEach } from "vitest";
import { tileSourceRect, characterSourceRect, loadImage, SPRITE_SOURCE_SIZE } from "./sprites";

describe("tileSourceRect", () => {
  it("returns the source rectangle for a tile's column index", () => {
    expect(tileSourceRect(0)).toEqual({
      sx: 0, sy: 0, sw: SPRITE_SOURCE_SIZE, sh: SPRITE_SOURCE_SIZE,
    });
    expect(tileSourceRect(2)).toEqual({
      sx: SPRITE_SOURCE_SIZE * 2, sy: 0, sw: SPRITE_SOURCE_SIZE, sh: SPRITE_SOURCE_SIZE,
    });
  });
});

describe("characterSourceRect", () => {
  it("maps direction to row and frame to column", () => {
    expect(characterSourceRect("down", 0)).toEqual({
      sx: 0, sy: 0, sw: SPRITE_SOURCE_SIZE, sh: SPRITE_SOURCE_SIZE,
    });
    expect(characterSourceRect("up", 2)).toEqual({
      sx: SPRITE_SOURCE_SIZE * 2,
      sy: SPRITE_SOURCE_SIZE * 3,
      sw: SPRITE_SOURCE_SIZE,
      sh: SPRITE_SOURCE_SIZE,
    });
  });

  it("wraps an out-of-range frame index back into 0-2", () => {
    expect(characterSourceRect("left", 4)).toEqual(characterSourceRect("left", 1));
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

import { describe, it, expect } from "vitest";
import {
  TILE_SIZE, TileType, MAP, MAP_WIDTH, MAP_HEIGHT, isInBounds, getTile,
} from "./map";

describe("map dimensions", () => {
  it("is 20 tiles wide and 16 tiles tall at 16px tiles", () => {
    expect(TILE_SIZE).toBe(16);
    expect(MAP_WIDTH).toBe(20);
    expect(MAP_HEIGHT).toBe(16);
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

  it("returns PROP for the 2x2 couch block", () => {
    expect(getTile(9, 7)).toBe(TileType.PROP);
    expect(getTile(10, 7)).toBe(TileType.PROP);
    expect(getTile(9, 8)).toBe(TileType.PROP);
    expect(getTile(10, 8)).toBe(TileType.PROP);
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

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
    expect(isWalkable(9, 7)).toBe(false);
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

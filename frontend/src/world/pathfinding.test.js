import { describe, it, expect } from "vitest";
import { findPathToAdjacent } from "./pathfinding";

describe("findPathToAdjacent", () => {
  it("returns an empty path when already adjacent", () => {
    expect(findPathToAdjacent({ x: 1, y: 1 }, { x: 2, y: 1 })).toEqual([]);
  });

  it("returns an empty path when start equals goal", () => {
    expect(findPathToAdjacent({ x: 1, y: 1 }, { x: 1, y: 1 })).toEqual([]);
  });

  it("finds a shortest path ending adjacent to the goal", () => {
    const path = findPathToAdjacent({ x: 1, y: 1 }, { x: 6, y: 1 });
    expect(path).not.toBeNull();
    const last = path[path.length - 1];
    expect(Math.abs(last.x - 6) + Math.abs(last.y - 1)).toBe(1);
    expect(path).toHaveLength(4); // (1,1) -> (2,1) -> (3,1) -> (4,1) -> (5,1)
  });

  it("routes around the couch obstacle at (4,3)-(5,3)", () => {
    const path = findPathToAdjacent({ x: 4, y: 2 }, { x: 4, y: 4 });
    expect(path).not.toBeNull();
    for (const step of path) {
      expect(step).not.toEqual({ x: 4, y: 3 });
      expect(step).not.toEqual({ x: 5, y: 3 });
    }
  });

  it("returns null when the goal is unreachable", () => {
    expect(findPathToAdjacent({ x: 1, y: 1 }, { x: -5, y: -5 })).toBeNull();
  });
});

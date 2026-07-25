import { describe, it, expect } from "vitest";
import { findPathBetween } from "./pathfinding";

describe("findPathBetween", () => {
  it("returns just the start when start equals goal", () => {
    expect(findPathBetween({ x: 1, y: 1 }, { x: 1, y: 1 })).toEqual([{ x: 1, y: 1 }]);
  });

  it("returns a two-tile path when already adjacent", () => {
    const path = findPathBetween({ x: 1, y: 1 }, { x: 2, y: 1 });
    expect(path).toEqual([{ x: 1, y: 1 }, { x: 2, y: 1 }]);
  });

  it("finds the shortest full path, inclusive of both ends", () => {
    const path = findPathBetween({ x: 1, y: 1 }, { x: 6, y: 1 });
    expect(path).toEqual([
      { x: 1, y: 1 }, { x: 2, y: 1 }, { x: 3, y: 1 },
      { x: 4, y: 1 }, { x: 5, y: 1 }, { x: 6, y: 1 },
    ]);
  });

  it("routes around the 2x2 couch block at (9,7)-(10,8)", () => {
    const path = findPathBetween({ x: 9, y: 6 }, { x: 9, y: 9 });
    expect(path).not.toBeNull();
    for (const step of path) {
      expect(step).not.toEqual({ x: 9, y: 7 });
      expect(step).not.toEqual({ x: 10, y: 7 });
      expect(step).not.toEqual({ x: 9, y: 8 });
      expect(step).not.toEqual({ x: 10, y: 8 });
    }
    expect(path[0]).toEqual({ x: 9, y: 6 });
    expect(path[path.length - 1]).toEqual({ x: 9, y: 9 });
  });

  it("every consecutive pair of tiles in the path is orthogonally adjacent", () => {
    const path = findPathBetween({ x: 1, y: 1 }, { x: 8, y: 6 });
    expect(path).not.toBeNull();
    for (let i = 1; i < path.length; i += 1) {
      const dist = Math.abs(path[i].x - path[i - 1].x) + Math.abs(path[i].y - path[i - 1].y);
      expect(dist).toBe(1);
    }
  });

  it("returns null when the goal is unreachable", () => {
    expect(findPathBetween({ x: 1, y: 1 }, { x: -5, y: -5 })).toBeNull();
  });
});

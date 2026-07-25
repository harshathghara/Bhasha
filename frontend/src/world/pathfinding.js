import { isWalkable } from "./movement";

const NEIGHBOR_DELTAS = [
  { dx: 0, dy: -1 },
  { dx: 0, dy: 1 },
  { dx: -1, dy: 0 },
  { dx: 1, dy: 0 },
];

// Full connected path from start to goal, inclusive of both endpoints.
// Returns [start] if start === goal, or null if goal is unreachable.
export function findPathBetween(start, goal) {
  if (start.x === goal.x && start.y === goal.y) return [start];

  const key = (p) => `${p.x},${p.y}`;
  const visited = new Set([key(start)]);
  const queue = [{ pos: start, path: [start] }];

  while (queue.length > 0) {
    const { pos, path } = queue.shift();

    for (const { dx, dy } of NEIGHBOR_DELTAS) {
      const next = { x: pos.x + dx, y: pos.y + dy };
      if (visited.has(key(next))) continue;
      if (!isWalkable(next.x, next.y)) continue;

      const nextPath = [...path, next];
      if (next.x === goal.x && next.y === goal.y) return nextPath;

      visited.add(key(next));
      queue.push({ pos: next, path: nextPath });
    }
  }

  return null;
}

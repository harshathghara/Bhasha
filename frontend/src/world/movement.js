import { TileType, getTile } from "./map";

export function isWalkable(x, y) {
  return getTile(x, y) === TileType.FLOOR;
}

const NEIGHBOR_DELTAS = [
  { dx: 0, dy: -1, direction: "up" },
  { dx: 0, dy: 1, direction: "down" },
  { dx: -1, dy: 0, direction: "left" },
  { dx: 1, dy: 0, direction: "right" },
];

export function occupiedTiles(characters, excludingId) {
  const occupied = new Set();
  for (const character of characters) {
    if (character.id === excludingId) continue;
    occupied.add(`${character.tileX},${character.tileY}`);
    if (character.targetX !== undefined && character.targetY !== undefined) {
      occupied.add(`${character.targetX},${character.targetY}`);
    }
  }
  return occupied;
}

export function pickRandomAdjacentTile(character, occupied, rng = Math.random) {
  const candidates = NEIGHBOR_DELTAS
    .map(({ dx, dy, direction }) => ({
      x: character.tileX + dx,
      y: character.tileY + dy,
      direction,
    }))
    .filter(({ x, y }) => isWalkable(x, y) && !occupied.has(`${x},${y}`));

  if (candidates.length === 0) return null;
  const index = Math.floor(rng() * candidates.length);
  return candidates[index];
}

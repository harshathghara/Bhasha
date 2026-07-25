export const TILE_SIZE = 32;

export const TileType = Object.freeze({ FLOOR: 0, WALL: 1, PROP: 2 });

const W = TileType.WALL;
const F = TileType.FLOOR;
const P = TileType.PROP;

export const MAP = [
  [W, W, W, W, W, W, W, W, W, W],
  [W, F, F, F, F, F, F, F, F, W],
  [W, F, F, F, F, F, F, F, F, W],
  [W, F, F, F, P, P, F, F, F, W],
  [W, F, F, F, F, F, F, F, F, W],
  [W, F, F, F, F, F, F, F, F, W],
  [W, F, F, F, F, F, F, F, F, W],
  [W, W, W, W, W, W, W, W, W, W],
];

export const MAP_WIDTH = MAP[0].length;
export const MAP_HEIGHT = MAP.length;

export function isInBounds(x, y) {
  return x >= 0 && x < MAP_WIDTH && y >= 0 && y < MAP_HEIGHT;
}

export function getTile(x, y) {
  if (!isInBounds(x, y)) return undefined;
  return MAP[y][x];
}

export const TILE_SIZE = 16;

export const TileType = Object.freeze({ FLOOR: 0, WALL: 1, PROP: 2 });

const MAP_COLS = 20;
const MAP_ROWS = 16;

// Couch: a 2x2 prop block near the center of the room.
const COUCH_X = 9;
const COUCH_Y = 7;

function buildMap() {
  const grid = [];
  for (let y = 0; y < MAP_ROWS; y += 1) {
    const row = [];
    for (let x = 0; x < MAP_COLS; x += 1) {
      const isBorder = x === 0 || y === 0 || x === MAP_COLS - 1 || y === MAP_ROWS - 1;
      row.push(isBorder ? TileType.WALL : TileType.FLOOR);
    }
    grid.push(row);
  }
  grid[COUCH_Y][COUCH_X] = TileType.PROP;
  grid[COUCH_Y][COUCH_X + 1] = TileType.PROP;
  grid[COUCH_Y + 1][COUCH_X] = TileType.PROP;
  grid[COUCH_Y + 1][COUCH_X + 1] = TileType.PROP;
  return grid;
}

export const MAP = buildMap();

export const MAP_WIDTH = MAP[0].length;
export const MAP_HEIGHT = MAP.length;

export function isInBounds(x, y) {
  return x >= 0 && x < MAP_WIDTH && y >= 0 && y < MAP_HEIGHT;
}

export function getTile(x, y) {
  if (!isInBounds(x, y)) return undefined;
  return MAP[y][x];
}

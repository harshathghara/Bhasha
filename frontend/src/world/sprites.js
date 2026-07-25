// The real sprite/tileset art fetched by scripts/fetch_real_assets.py is
// authored at 16px per tile/frame, independent of TILE_SIZE (the world
// grid's drawing size). drawImage scales SPRITE_SOURCE_SIZE source pixels
// up to TILE_SIZE destination pixels, which is what gives the chunky 2x
// pixel-art look at the current TILE_SIZE=32.
export const SPRITE_SOURCE_SIZE = 16;

export const DIRECTIONS = ["down", "left", "right", "up"];
export const FRAMES_PER_DIRECTION = 3;

export function tileSourceRect(tileType) {
  return {
    sx: tileType * SPRITE_SOURCE_SIZE, sy: 0, sw: SPRITE_SOURCE_SIZE, sh: SPRITE_SOURCE_SIZE,
  };
}

export function characterSourceRect(direction, frame) {
  const row = DIRECTIONS.indexOf(direction);
  if (row === -1) {
    throw new Error(`Unknown direction: ${direction}`);
  }
  const col = ((frame % FRAMES_PER_DIRECTION) + FRAMES_PER_DIRECTION) % FRAMES_PER_DIRECTION;
  return {
    sx: col * SPRITE_SOURCE_SIZE,
    sy: row * SPRITE_SOURCE_SIZE,
    sw: SPRITE_SOURCE_SIZE,
    sh: SPRITE_SOURCE_SIZE,
  };
}

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Failed to load image: ${src}`));
    image.src = src;
  });
}

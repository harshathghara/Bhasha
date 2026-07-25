import { TILE_SIZE } from "./map";

export const DIRECTIONS = ["down", "left", "right", "up"];
export const FRAMES_PER_DIRECTION = 4;

export function tileSourceRect(tileType) {
  return { sx: tileType * TILE_SIZE, sy: 0, sw: TILE_SIZE, sh: TILE_SIZE };
}

export function characterSourceRect(direction, frame) {
  const row = DIRECTIONS.indexOf(direction);
  if (row === -1) {
    throw new Error(`Unknown direction: ${direction}`);
  }
  const col = ((frame % FRAMES_PER_DIRECTION) + FRAMES_PER_DIRECTION) % FRAMES_PER_DIRECTION;
  return { sx: col * TILE_SIZE, sy: row * TILE_SIZE, sw: TILE_SIZE, sh: TILE_SIZE };
}

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Failed to load image: ${src}`));
    image.src = src;
  });
}

"""Generate placeholder pixel-art assets for the World UI.

Run once from frontend/: `python3 scripts/generate_placeholder_assets.py`
Outputs deterministic, license-free placeholder PNGs to src/world/assets/.
Swap these for real art later without touching any rendering code, as
long as the replacement keeps the same tile size (32px) and the same
tileset/character-sheet grid layout documented in sprites.js.
"""
from pathlib import Path

from PIL import Image, ImageDraw

TILE_SIZE = 32
ASSETS_DIR = Path(__file__).resolve().parent.parent / "src" / "world" / "assets"

# (fill, border) per tile, in TileType order: FLOOR=0, WALL=1, PROP=2
TILE_COLORS = [
    ((214, 197, 158), (194, 177, 138)),  # floor
    ((92, 92, 102), (56, 56, 64)),        # wall
    ((150, 105, 70), (110, 75, 48)),      # prop
]

CHARACTER_COLORS = {
    "slot-1": (198, 60, 60),
    "slot-2": (60, 110, 198),
    "slot-3": (70, 168, 90),
    "slot-4": (206, 178, 52),
    "slot-5": (150, 70, 178),
}

DIRECTIONS = ["down", "left", "right", "up"]
FRAMES_PER_DIRECTION = 4

FACING_OFFSET = {
    "down": (0, 6),
    "up": (0, -6),
    "left": (-6, 0),
    "right": (6, 0),
}


def generate_tileset():
    image = Image.new("RGBA", (TILE_SIZE * len(TILE_COLORS), TILE_SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    for index, (fill, border) in enumerate(TILE_COLORS):
        x0 = index * TILE_SIZE
        box = [x0, 0, x0 + TILE_SIZE - 1, TILE_SIZE - 1]
        draw.rectangle(box, fill=fill)
        draw.rectangle(box, outline=border, width=2)
    image.save(ASSETS_DIR / "tileset.png")


def generate_character_sheet(sprite_key, color):
    width = TILE_SIZE * FRAMES_PER_DIRECTION
    height = TILE_SIZE * len(DIRECTIONS)
    image = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)

    for row, direction in enumerate(DIRECTIONS):
        fx, fy = FACING_OFFSET[direction]
        for frame in range(FRAMES_PER_DIRECTION):
            cx = frame * TILE_SIZE + TILE_SIZE // 2
            cy = row * TILE_SIZE + TILE_SIZE // 2
            bob = 2 if frame % 2 == 1 else 0
            radius = 10
            draw.ellipse(
                [cx - radius, cy - radius + bob, cx + radius, cy + radius + bob],
                fill=color,
                outline=(0, 0, 0, 255),
                width=2,
            )
            nose_x, nose_y = cx + fx, cy + fy + bob
            draw.ellipse(
                [nose_x - 3, nose_y - 3, nose_x + 3, nose_y + 3],
                fill=(0, 0, 0, 255),
            )

    image.save(ASSETS_DIR / f"char-{sprite_key}.png")


def main():
    ASSETS_DIR.mkdir(parents=True, exist_ok=True)
    generate_tileset()
    for sprite_key, color in CHARACTER_COLORS.items():
        generate_character_sheet(sprite_key, color)
    print(f"Wrote tileset.png and {len(CHARACTER_COLORS)} character sheets to {ASSETS_DIR}")


if __name__ == "__main__":
    main()

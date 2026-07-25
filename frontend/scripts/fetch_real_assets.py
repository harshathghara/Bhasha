"""Fetch and repack real CC-licensed pixel art for the World UI.

Run once from frontend/: `python3 scripts/fetch_real_assets.py`
Downloads four OpenGameArt.org sheets, crops out the specific tiles/frames
this project uses, and repacks them into the grid layout src/world/sprites.js
expects. Replaces the fully self-generated placeholders that used to live in
src/world/assets/. See src/world/assets/CREDITS.md for licenses/sources.

Requires network access. If it fails (offline, source moved), the previous
committed assets in src/world/assets/ remain valid until this is re-run.
"""
import urllib.request
from pathlib import Path

from PIL import Image

ASSETS_DIR = Path(__file__).resolve().parent.parent / "src" / "world" / "assets"
SOURCE_SIZE = 16  # native pixel size of every source tile/frame used below

SOURCES = {
    "characters": "https://opengameart.org/sites/default/files/SpriteSheet_5.png",
    "walls_floor_doors": "https://opengameart.org/sites/default/files/walls_floor_doors.png",
    "tiles16": "https://opengameart.org/sites/default/files/16x16-tiles_0.png",
    "furniture": "https://opengameart.org/sites/default/files/furniture_0.png",
}

# tiles16.png is also not a perfectly uniform 16px grid (see the
# CHARACTER_*_STARTS comment below for why fixed-pitch cropping is unsafe).
# Exact detected cell-start offsets.
TILES16_COL_STARTS = [1, 18, 35, 52, 69, 86, 103]
TILES16_ROW_STARTS = [1, 18, 35, 52, 69]

# 5 of the 6 character rows in SpriteSheet_5.png, chosen for visual variety.
# Each row is 9 columns of ~16px cells: cols 0-2 = down, 3-5 = profile
# (facing right), 6-8 = up. There is no separate "left" row in the source —
# we build it by flipping the profile frames horizontally.
CHARACTER_ROWS = {
    "slot-1": 0,  # green cap
    "slot-2": 1,  # dark teal
    "slot-3": 2,  # gray hooded
    "slot-4": 3,  # brown-hair
    "slot-5": 4,  # purple-hair
}

DOWN_COLS = [0, 1, 2]
# The source's "side" block (cols 3-5) faces RIGHT natively: the back-item
# (backpack) sits on the frame's left edge, matching the same item's
# position in the UP (back-view) block, and the face/skin sits on the
# right edge. So this block is our "right" row as-is; "left" is its
# horizontal flip — not the other way around.
PROFILE_COLS = [3, 4, 5]
UP_COLS = [6, 7, 8]

# SpriteSheet_5.png is NOT a perfectly uniform 16px grid: there's a 1-2px
# gutter between cells that grows across the sheet, so cropping at a fixed
# col*16/row*16 pitch drifts by several pixels by the later rows/columns and
# picks up a sliver of the neighboring cell. These are the exact pixel
# offsets of each cell's left/top edge, detected by scanning the sheet's
# alpha channel for the start of each row/column of non-transparent content.
CHARACTER_COL_STARTS = [0, 17, 34, 52, 68, 85, 102, 119, 136]
CHARACTER_ROW_STARTS = [0, 17, 34, 51, 68, 85]


def fetch(name, url):
    dest = ASSETS_DIR / f"_source_{name}.png"
    urllib.request.urlretrieve(url, dest)  # noqa: S310 (trusted, hardcoded URL)
    return Image.open(dest).convert("RGBA")


def cell(image, col, row, size=SOURCE_SIZE):
    x0, y0 = col * size, row * size
    return image.crop((x0, y0, x0 + size, y0 + size))


def character_cell(characters, col, row, size=SOURCE_SIZE):
    x0 = CHARACTER_COL_STARTS[col]
    y0 = CHARACTER_ROW_STARTS[row]
    return characters.crop((x0, y0, x0 + size, y0 + size))


def tiles16_cell(tiles16, col, row, size=SOURCE_SIZE):
    x0 = TILES16_COL_STARTS[col]
    y0 = TILES16_ROW_STARTS[row]
    return tiles16.crop((x0, y0, x0 + size, y0 + size))


def build_tileset(walls_floor_doors, tiles16, furniture):
    """FLOOR, WALL, PROP in that order (TileType.FLOOR=0, WALL=1, PROP=2)."""
    floor = tiles16_cell(tiles16, 0, 1)  # muted moss/stone, not a bright color
    wall = cell(walls_floor_doors, 0, 2)
    prop = cell(furniture, 2, 2)  # a red armchair (the couch)

    tileset = Image.new("RGBA", (SOURCE_SIZE * 3, SOURCE_SIZE), (0, 0, 0, 0))
    for index, tile in enumerate([floor, wall, prop]):
        tileset.paste(tile, (index * SOURCE_SIZE, 0))
    tileset.save(ASSETS_DIR / "tileset.png")


def build_character_sheet(sprite_key, row, characters):
    down = [character_cell(characters, col, row) for col in DOWN_COLS]
    right = [character_cell(characters, col, row) for col in PROFILE_COLS]
    left = [frame.transpose(Image.FLIP_LEFT_RIGHT) for frame in right]
    up = [character_cell(characters, col, row) for col in UP_COLS]

    frames_per_direction = len(down)
    sheet = Image.new(
        "RGBA",
        (SOURCE_SIZE * frames_per_direction, SOURCE_SIZE * 4),
        (0, 0, 0, 0),
    )
    for row_index, frames in enumerate([down, left, right, up]):
        for col_index, frame in enumerate(frames):
            sheet.paste(frame, (col_index * SOURCE_SIZE, row_index * SOURCE_SIZE))
    sheet.save(ASSETS_DIR / f"char-{sprite_key}.png")


def main():
    ASSETS_DIR.mkdir(parents=True, exist_ok=True)
    characters = fetch("characters", SOURCES["characters"])
    walls_floor_doors = fetch("walls_floor_doors", SOURCES["walls_floor_doors"])
    tiles16 = fetch("tiles16", SOURCES["tiles16"])
    furniture = fetch("furniture", SOURCES["furniture"])

    build_tileset(walls_floor_doors, tiles16, furniture)
    for sprite_key, row in CHARACTER_ROWS.items():
        build_character_sheet(sprite_key, row, characters)

    for name in SOURCES:
        (ASSETS_DIR / f"_source_{name}.png").unlink()

    print(f"Wrote tileset.png and {len(CHARACTER_ROWS)} character sheets to {ASSETS_DIR}")


if __name__ == "__main__":
    main()

# World UI assets

`tileset.png` and `char-slot-*.png` in this directory are built by
`frontend/scripts/fetch_real_assets.py`, which downloads the source sheets
below from OpenGameArt.org and crops/repacks specific tiles and frames into
the grid layout `sprites.js` expects (16px native size per tile/frame; see
`SPRITE_SOURCE_SIZE`/`FRAMES_PER_DIRECTION` there). Re-run that script to
regenerate these files from scratch.

## Sources

- **Characters** — [Top Down Pokemon-esque Sprites](https://opengameart.org/content/top-down-pokemon-esque-sprites)
  on OpenGameArt.org. License: **CC0** (public domain) — no attribution
  required, though the creator appreciates seeing it used. `char-slot-1.png`
  through `char-slot-5.png` are five of the sheet's six character color
  variants, each recombined into a down/left/right/up walk-cycle sheet. The
  source has no separate "left" row — its one profile row faces right
  natively (confirmed by cross-referencing the backpack's position against
  the source's back-view frame); our "left" row is that profile row flipped
  horizontally.

- **Walls and furniture (couch)** — [16x16 Indoor RPG Tileset](https://opengameart.org/content/16x16-indoor-rpg-tileset)
  by [tilation](https://tilation.itch.io/). License: **CC-BY 3.0** —
  attribution required. `tileset.png`'s wall tile comes from
  `walls_floor_doors.png`; its prop tile (the couch) comes from
  `furniture_0.png`.

- **Floor** — [16x16 Tiles](https://opengameart.org/content/16x16-tiles)
  on OpenGameArt.org. License: **CC0** (public domain). `tileset.png`'s
  floor tile is a muted moss/stone tile from this sheet, deliberately chosen
  over brighter/saturated alternatives (the other candidate tile sources
  only had bright reds/blues/pinks).

Attribution: wall and couch art by [tilation](https://tilation.itch.io/),
used under CC-BY 3.0.

import { useEffect, useRef, useState } from "react";
import { MAP_WIDTH, MAP_HEIGHT, TILE_SIZE } from "../world/map";
import { loadImage } from "../world/sprites";
import { WorldEngine } from "../world/engine";

export default function WorldView({ characters }) {
  const canvasRef = useRef(null);
  const [loadError, setLoadError] = useState(null);

  useEffect(() => {
    let engine;
    let cancelled = false;

    async function setup() {
      try {
        const uniqueSpriteKeys = [...new Set(characters.map((c) => c.spriteKey))];
        const [tileset, ...characterImages] = await Promise.all([
          loadImage(new URL("../world/assets/tileset.png", import.meta.url).href),
          ...uniqueSpriteKeys.map((key) => (
            loadImage(new URL(`../world/assets/char-${key}.png`, import.meta.url).href)
          )),
        ]);

        if (cancelled) return;

        const characterSheets = {};
        uniqueSpriteKeys.forEach((key, index) => {
          characterSheets[key] = characterImages[index];
        });

        const ctx = canvasRef.current.getContext("2d");
        engine = new WorldEngine(ctx, characters, { tileset, characters: characterSheets });
        engine.start();
      } catch (error) {
        if (!cancelled) setLoadError(error.message);
      }
    }

    setup();

    return () => {
      cancelled = true;
      if (engine) engine.stop();
    };
  }, [characters]);

  if (loadError) {
    return <p role="alert">World assets failed to load: {loadError}</p>;
  }

  return (
    <canvas
      ref={canvasRef}
      width={MAP_WIDTH * TILE_SIZE}
      height={MAP_HEIGHT * TILE_SIZE}
      data-testid="world-canvas"
    />
  );
}

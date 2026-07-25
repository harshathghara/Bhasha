import { useEffect, useRef, useState } from "react";
import { MAP_WIDTH, MAP_HEIGHT, TILE_SIZE } from "../world/map";
import { loadImage } from "../world/sprites";
import { WorldEngine } from "../world/engine";

const shellStyle = {
  width: "100vw",
  height: "100vh",
  margin: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "#1a1a1e",
  overflow: "hidden",
};

const canvasStyle = {
  // Largest size that fits the viewport while keeping the 10:8 map aspect ratio.
  width: "min(100vw, calc(100vh * 10 / 8))",
  height: "min(100vh, calc(100vw * 8 / 10))",
  imageRendering: "pixelated",
  display: "block",
};

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
        ctx.imageSmoothingEnabled = false;
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
    return (
      <div style={shellStyle}>
        <p role="alert">World assets failed to load: {loadError}</p>
      </div>
    );
  }

  return (
    <div style={shellStyle} data-testid="world-shell">
      <canvas
        ref={canvasRef}
        width={MAP_WIDTH * TILE_SIZE}
        height={MAP_HEIGHT * TILE_SIZE}
        style={canvasStyle}
        data-testid="world-canvas"
      />
    </div>
  );
}

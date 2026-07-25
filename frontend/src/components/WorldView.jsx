import { useEffect, useRef, useState } from "react";
import { MAP_WIDTH, MAP_HEIGHT, TILE_SIZE } from "../world/map";
import { loadImage } from "../world/sprites";
import { WorldEngine } from "../world/engine";
import { openEventSocket } from "../api/client";

const FRAME_THROTTLE_MS = 100;
const BUBBLE_TEXT_MAX_LENGTH = 80;
const BUBBLE_ICONS = { public: "\u{1F4AC}", private: "\u{1F512}", confession: "\u{1F4AD}" };

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

const frameStyle = {
  position: "relative",
  width: "min(100vw, calc(100vh * 10 / 8))",
  height: "min(100vh, calc(100vw * 8 / 10))",
};

const canvasStyle = {
  width: "100%",
  height: "100%",
  imageRendering: "pixelated",
  display: "block",
};

const overlayStyle = {
  position: "absolute",
  inset: 0,
  pointerEvents: "none",
};

const bubbleStyle = {
  position: "absolute",
  transform: "translate(-50%, -100%)",
  background: "#ffffff",
  color: "#000000",
  borderRadius: "6px",
  padding: "4px 8px",
  fontSize: "12px",
  maxWidth: "160px",
  boxShadow: "0 1px 3px rgba(0,0,0,0.4)",
};

const bannerStyle = {
  position: "absolute",
  bottom: "8px",
  left: "50%",
  transform: "translateX(-50%)",
  background: "#ffffff",
  color: "#000000",
  borderRadius: "6px",
  padding: "6px 12px",
  fontSize: "13px",
  maxWidth: "80%",
};

function truncate(text) {
  if (text.length <= BUBBLE_TEXT_MAX_LENGTH) return text;
  return `${text.slice(0, BUBBLE_TEXT_MAX_LENGTH)}…`;
}

export default function WorldView({ showId, characters }) {
  const canvasRef = useRef(null);
  const [loadError, setLoadError] = useState(null);
  const [frame, setFrame] = useState({ characters: [], gmBanner: null });

  useEffect(() => {
    let engine;
    let socket;
    let cancelled = false;
    let lastFrameStateAt = 0;

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
        engine = new WorldEngine(ctx, characters, { tileset, characters: characterSheets }, {
          onFrame: (snapshot) => {
            const now = performance.now();
            if (now - lastFrameStateAt < FRAME_THROTTLE_MS) return;
            lastFrameStateAt = now;
            setFrame(snapshot);
          },
        });
        engine.start();

        socket = openEventSocket(showId, (event) => {
          if (engine) engine.handleEvent(event);
        });
      } catch (error) {
        if (!cancelled) setLoadError(error.message);
      }
    }

    setup();

    return () => {
      cancelled = true;
      if (engine) engine.stop();
      if (socket) socket.close();
    };
  }, [showId, characters]);

  if (loadError) {
    return (
      <div style={shellStyle}>
        <p role="alert">World assets failed to load: {loadError}</p>
      </div>
    );
  }

  return (
    <div style={shellStyle} data-testid="world-shell">
      <div style={frameStyle}>
        <canvas
          ref={canvasRef}
          width={MAP_WIDTH * TILE_SIZE}
          height={MAP_HEIGHT * TILE_SIZE}
          style={canvasStyle}
          data-testid="world-canvas"
        />
        <div style={overlayStyle}>
          {frame.characters.filter((c) => c.bubble).map((c) => (
            <div
              key={c.id}
              data-testid={`bubble-${c.id}`}
              style={{
                ...bubbleStyle,
                left: `${((c.pixelX + TILE_SIZE / 2) / (MAP_WIDTH * TILE_SIZE)) * 100}%`,
                top: `${(c.pixelY / (MAP_HEIGHT * TILE_SIZE)) * 100}%`,
              }}
            >
              {BUBBLE_ICONS[c.bubble.kind]} {truncate(c.bubble.text)}
            </div>
          ))}
        </div>
        {frame.gmBanner && (
          <div style={bannerStyle} data-testid="gm-banner">{frame.gmBanner.text}</div>
        )}
      </div>
    </div>
  );
}

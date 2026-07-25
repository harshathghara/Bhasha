import { useEffect, useMemo, useRef, useState } from "react";
import { MAP_WIDTH, MAP_HEIGHT, TILE_SIZE } from "../world/map";
import {
  loadImage,
  SPRITE_SOURCE_SIZE,
  DIRECTIONS,
  FRAMES_PER_DIRECTION,
} from "../world/sprites";
import { WorldEngine } from "../world/engine";
import { openEventSocket } from "../api/client";

const FRAME_THROTTLE_MS = 100;
const BUBBLE_TEXT_MAX_LENGTH = 80;
const BUBBLE_ICONS = { public: "\u{1F4AC}", private: "\u{1F512}", confession: "\u{1F4AD}" };
const PORTRAIT_DISPLAY_SIZE = 28;
const PIXEL_FONT = '"Press Start 2P", "VT323", monospace';

const SENDER_PALETTE = [
  "#e74c3c",
  "#3498db",
  "#2ecc71",
  "#f39c12",
  "#9b59b6",
  "#1abc9c",
  "#e91e63",
  "#00bcd4",
];

const shellStyle = {
  position: "relative",
  width: "100vw",
  height: "100vh",
  margin: 0,
  background: "#1a1a1e",
  overflow: "hidden",
};

// Same centered aspect-fit frame as before the chat panel existed.
const frameStyle = {
  position: "absolute",
  top: "50%",
  left: "50%",
  transform: "translate(-50%, -50%)",
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

const bubbleShellStyle = {
  position: "absolute",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  maxWidth: "200px",
  filter: "drop-shadow(0 2px 0 rgba(0,0,0,0.35))",
};

// Keep the bubble body inside the frame when the speaker is near an edge.
const BUBBLE_EDGE_X_PCT = 14;
const BUBBLE_FLIP_TOP_PCT = 22;

const bubbleBodyStyle = {
  display: "flex",
  alignItems: "center",
  gap: "8px",
  background: "#ffffff",
  color: "#000000",
  border: "2px solid #111111",
  borderRadius: "4px",
  padding: "6px 8px",
  fontFamily: PIXEL_FONT,
  fontSize: "8px",
  lineHeight: 1.5,
  imageRendering: "pixelated",
};

const portraitStyle = {
  width: `${PORTRAIT_DISPLAY_SIZE}px`,
  height: `${PORTRAIT_DISPLAY_SIZE}px`,
  flexShrink: 0,
  border: "2px solid #111111",
  backgroundColor: "#c8c0a8",
  imageRendering: "pixelated",
  backgroundRepeat: "no-repeat",
};

const bubbleTextStyle = {
  minWidth: 0,
  wordBreak: "break-word",
};

const bubbleTailStyle = {
  width: 0,
  height: 0,
  borderLeft: "7px solid transparent",
  borderRight: "7px solid transparent",
  borderTop: "10px solid #111111",
  marginTop: "-2px",
  position: "relative",
};

const bubbleTailInnerStyle = {
  position: "absolute",
  left: "-5px",
  top: "-10px",
  width: 0,
  height: 0,
  borderLeft: "5px solid transparent",
  borderRight: "5px solid transparent",
  borderTop: "8px solid #ffffff",
};

const bannerStyle = {
  position: "absolute",
  bottom: "8px",
  left: "50%",
  transform: "translateX(-50%)",
  background: "#ffffff",
  color: "#000000",
  border: "2px solid #111111",
  borderRadius: "4px",
  padding: "8px 12px",
  fontFamily: PIXEL_FONT,
  fontSize: "9px",
  lineHeight: 1.5,
  maxWidth: "80%",
  imageRendering: "pixelated",
};

// Fills the leftover gutter to the right of the centered game frame.
const chatPaneStyle = {
  position: "absolute",
  top: 0,
  right: 0,
  bottom: 0,
  left: "calc(50% + min(50vw, calc(100vh * 5 / 8)))",
  minWidth: 0,
  display: "flex",
  flexDirection: "column",
  background: "#121216",
  borderLeft: "1px solid #2a2a32",
  color: "#e8e8ec",
  fontFamily: '"IBM Plex Sans", "Segoe UI", system-ui, sans-serif',
  overflow: "hidden",
  zIndex: 1,
};

const chatHeaderStyle = {
  padding: "12px 14px",
  borderBottom: "1px solid #2a2a32",
  fontFamily: PIXEL_FONT,
  fontSize: "9px",
  letterSpacing: "0.04em",
  color: "#c8c0a8",
};

const chatListStyle = {
  listStyle: "none",
  margin: 0,
  padding: "10px 12px",
  overflowY: "auto",
  flex: 1,
  minHeight: 0,
  display: "flex",
  flexDirection: "column",
  gap: "10px",
};

const chatEmptyStyle = {
  padding: "16px 14px",
  color: "#6a6a74",
  fontSize: "13px",
};

function truncate(text) {
  if (text.length <= BUBBLE_TEXT_MAX_LENGTH) return text;
  return `${text.slice(0, BUBBLE_TEXT_MAX_LENGTH)}…`;
}

/** Stable color per character; GM / narrator get fixed accents. */
export function colorForSender(senderId, characterIds) {
  if (!senderId || senderId === "game_master") return "#d4a017";
  if (senderId === "narrator") return "#95a5a6";
  const index = characterIds.indexOf(senderId);
  if (index < 0) return "#bdc3c7";
  return SENDER_PALETTE[index % SENDER_PALETTE.length];
}

export function chatKindLabel(event) {
  if (event.kind === "confession") return "confession";
  if (event.kind === "gm_ruling") return "gm ruling";
  if (event.kind === "gm_announcement") return "gm";
  if (event.kind === "narration") return "narration";
  if (event.kind === "agent_action" && event.visibility === "private") return "private";
  if (event.kind === "agent_action" && event.visibility === "public") return "public";
  if (event.visibility === "private") return `private · ${event.kind || "event"}`;
  return event.kind || "event";
}

export function chatSenderName(senderId, charactersById) {
  if (!senderId) return "Unknown";
  if (senderId === "game_master") return "Game Master";
  if (senderId === "narrator") return "Narrator";
  return charactersById.get(senderId)?.name || senderId;
}

/** Anchor the bubble so it stays on-screen; flip below the speaker near the top edge. */
export function bubblePlacement(pixelX, pixelY) {
  const mapW = MAP_WIDTH * TILE_SIZE;
  const mapH = MAP_HEIGHT * TILE_SIZE;
  const rawX = ((pixelX + TILE_SIZE / 2) / mapW) * 100;
  const rawY = (pixelY / mapH) * 100;
  const flipBelow = rawY < BUBBLE_FLIP_TOP_PCT;
  const left = Math.min(100 - BUBBLE_EDGE_X_PCT, Math.max(BUBBLE_EDGE_X_PCT, rawX));
  const top = flipBelow
    ? Math.min(92, ((pixelY + TILE_SIZE) / mapH) * 100)
    : rawY;
  // Shift the pointer toward the character when the bubble was slid horizontally.
  const tailOffsetPct = Math.max(-42, Math.min(42, (rawX - left) * 3.5));
  return {
    left,
    top,
    flipBelow,
    tailOffsetPct,
    transform: flipBelow
      ? "translate(-50%, 8px)"
      : "translate(-50%, calc(-100% - 10px))",
  };
}

function tailStyles(flipBelow, tailOffsetPct) {
  if (flipBelow) {
    return {
      outer: {
        width: 0,
        height: 0,
        borderLeft: "7px solid transparent",
        borderRight: "7px solid transparent",
        borderBottom: "10px solid #111111",
        marginBottom: "-2px",
        position: "relative",
        left: `${tailOffsetPct}%`,
        order: -1,
      },
      inner: {
        position: "absolute",
        left: "-5px",
        top: "2px",
        width: 0,
        height: 0,
        borderLeft: "5px solid transparent",
        borderRight: "5px solid transparent",
        borderBottom: "8px solid #ffffff",
      },
    };
  }

  return {
    outer: {
      ...bubbleTailStyle,
      left: `${tailOffsetPct}%`,
    },
    inner: bubbleTailInnerStyle,
  };
}

function portraitBackground(spriteUrl) {
  const sheetW = FRAMES_PER_DIRECTION * SPRITE_SOURCE_SIZE;
  const sheetH = DIRECTIONS.length * SPRITE_SOURCE_SIZE;
  const scale = PORTRAIT_DISPLAY_SIZE / SPRITE_SOURCE_SIZE;
  return {
    backgroundImage: `url(${spriteUrl})`,
    backgroundSize: `${sheetW * scale}px ${sheetH * scale}px`,
    // Down-facing idle frame (row 0, col 0) — matches DIRECTIONS[0] === "down".
    backgroundPosition: "0 0",
  };
}

function characterAssetUrl(spriteKey) {
  return new URL(`../world/assets/char-${spriteKey}.png`, import.meta.url).href;
}

function recipientNames(event, charactersById) {
  const recipients = event.recipients || [];
  if (recipients.length === 0) return null;
  return recipients
    .map((id) => chatSenderName(id, charactersById))
    .join(", ");
}

export default function WorldView({ showId, characters, onDialogueBusyChange }) {
  const canvasRef = useRef(null);
  const chatEndRef = useRef(null);
  const dialogueBusyRef = useRef(false);
  const onDialogueBusyChangeRef = useRef(onDialogueBusyChange);
  const [loadError, setLoadError] = useState(null);
  const [frame, setFrame] = useState({ characters: [], gmBanner: null, dialogueBusy: false });
  const [chatLog, setChatLog] = useState([]);

  const charactersById = useMemo(
    () => new Map(characters.map((character) => [character.id, character])),
    [characters],
  );

  const characterIds = useMemo(
    () => characters.map((character) => character.id),
    [characters],
  );

  useEffect(() => {
    onDialogueBusyChangeRef.current = onDialogueBusyChange;
  }, [onDialogueBusyChange]);

  useEffect(() => {
    setChatLog([]);
  }, [showId]);

  useEffect(() => {
    const end = chatEndRef.current;
    if (end && typeof end.scrollIntoView === "function") {
      end.scrollIntoView({ behavior: "smooth" });
    }
  }, [chatLog]);

  useEffect(() => {
    let engine;
    let socket;
    let cancelled = false;
    let lastFrameStateAt = 0;
    dialogueBusyRef.current = false;
    onDialogueBusyChangeRef.current?.(false);

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
            if (snapshot.dialogueBusy !== dialogueBusyRef.current) {
              dialogueBusyRef.current = snapshot.dialogueBusy;
              onDialogueBusyChangeRef.current?.(snapshot.dialogueBusy);
            }
          },
        });
        engine.start();

        socket = openEventSocket(showId, (event) => {
          if (engine) engine.handleEvent(event);
          setChatLog((prev) => [...prev, event]);
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
          {frame.characters.filter((c) => c.bubble).map((c) => {
            const spriteKey = charactersById.get(c.id)?.spriteKey;
            const placement = bubblePlacement(c.pixelX, c.pixelY);
            const tail = tailStyles(placement.flipBelow, placement.tailOffsetPct);
            return (
              <div
                key={c.id}
                data-testid={`bubble-${c.id}`}
                data-placement={placement.flipBelow ? "below" : "above"}
                style={{
                  ...bubbleShellStyle,
                  left: `${placement.left}%`,
                  top: `${placement.top}%`,
                  transform: placement.transform,
                }}
              >
                <div style={bubbleBodyStyle}>
                  {spriteKey && (
                    <div
                      data-testid={`bubble-portrait-${c.id}`}
                      aria-hidden="true"
                      style={{
                        ...portraitStyle,
                        ...portraitBackground(characterAssetUrl(spriteKey)),
                      }}
                    />
                  )}
                  <div style={bubbleTextStyle}>
                    {BUBBLE_ICONS[c.bubble.kind]} {truncate(c.bubble.text)}
                  </div>
                </div>
                <div data-testid={`bubble-tail-${c.id}`} style={tail.outer} aria-hidden="true">
                  <div style={tail.inner} />
                </div>
              </div>
            );
          })}
        </div>
        {frame.gmBanner && (
          <div style={bannerStyle} data-testid="gm-banner">{frame.gmBanner.text}</div>
        )}
      </div>

      <aside style={chatPaneStyle} data-testid="world-chat" aria-label="Full chat log">
        <div style={chatHeaderStyle}>Full chat</div>
        {chatLog.length === 0 ? (
          <p style={chatEmptyStyle}>
            The house is quiet. Show yet to start — stay tuned.
          </p>
        ) : (
          <ul style={chatListStyle}>
            {chatLog.map((event, index) => {
              const color = colorForSender(event.sender_id, characterIds);
              const to = recipientNames(event, charactersById);
              const key = event.seq != null ? `seq-${event.seq}` : `idx-${index}`;
              return (
                <li
                  key={key}
                  data-testid={`chat-entry-${key}`}
                  data-sender={event.sender_id || ""}
                  data-kind={event.kind || ""}
                  data-visibility={event.visibility || ""}
                  style={{
                    borderLeft: `3px solid ${color}`,
                    flexShrink: 0,
                    paddingLeft: "10px",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: "6px",
                      alignItems: "baseline",
                      marginBottom: "4px",
                      fontSize: "11px",
                      lineHeight: 1.3,
                    }}
                  >
                    <span
                      style={{
                        color,
                        fontWeight: 700,
                        fontSize: "13px",
                      }}
                    >
                      {chatSenderName(event.sender_id, charactersById)}
                    </span>
                    <span
                      style={{
                        color: "#8a8a96",
                        textTransform: "uppercase",
                        letterSpacing: "0.04em",
                        fontSize: "10px",
                      }}
                    >
                      {chatKindLabel(event)}
                    </span>
                    {to && (
                      <span style={{ color: "#8a8a96", fontSize: "11px" }}>
                        → {to}
                      </span>
                    )}
                  </div>
                  <div
                    data-testid={`chat-text-${key}`}
                    style={{
                      color: "#e8e8ec",
                      fontSize: "13px",
                      lineHeight: 1.45,
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                    }}
                  >
                    {event.text ?? ""}
                  </div>
                </li>
              );
            })}
            <li ref={chatEndRef} aria-hidden="true" style={{ height: 0, padding: 0, margin: 0 }} />
          </ul>
        )}
      </aside>
    </div>
  );
}

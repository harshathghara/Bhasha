import { useEffect, useMemo, useRef, useState } from "react";
import { MAP_WIDTH, MAP_HEIGHT, TILE_SIZE } from "../world/map";
import {
  loadImage,
  SPRITE_SOURCE_SIZE,
  DIRECTIONS,
  FRAMES_PER_DIRECTION,
} from "../world/sprites";
import { WorldEngine } from "../world/engine";
import { openEventSocket, leakEvent } from "../api/client";
import LeakConfirmDialog from "./LeakConfirmDialog";
import {
  SPEECH_STYLES,
  chatCardStyles,
  speechKindFromBubble,
  speechKindFromEvent,
  speechLabelFromEvent,
} from "../world/speechStyles";

const FRAME_THROTTLE_MS = 100;
const BUBBLE_TEXT_MAX_LENGTH = 80;
const PORTRAIT_DISPLAY_SIZE = 28;
const PIXEL_FONT = '"Press Start 2P", "VT323", monospace';

const SENDER_PALETTE = [
  "#df9daa",
  "#8eb9de",
  "#94c5a3",
  "#eab879",
  "#bc9bd4",
  "#8dc6bd",
  "#dc9fbe",
  "#8dcbd5",
];

const shellStyle = {
  display: "flex",
  flexDirection: "row",
  width: "100vw",
  height: "100vh",
  margin: 0,
  background: "#1a1a1e",
  overflow: "hidden",
};

const gameAreaStyle = {
  flex: "1 1 0",
  minWidth: 0,
  position: "relative",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  overflow: "hidden",
};

// Centered 5:4 game frame inside the flexible left column.
const frameStyle = {
  position: "relative",
  width: "min(100%, calc(100vh * 10 / 8))",
  aspectRatio: "10 / 8",
  maxHeight: "100%",
  maxWidth: "100%",
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
  filter: "drop-shadow(0 2px 0 rgba(109, 86, 118, 0.2))",
};

// Keep the bubble body inside the frame when the speaker is near an edge.
const BUBBLE_EDGE_X_PCT = 14;
const BUBBLE_FLIP_TOP_PCT = 22;

const bubbleBodyBaseStyle = {
  display: "flex",
  alignItems: "center",
  gap: "8px",
  borderRadius: "4px",
  padding: "6px 8px",
  fontFamily: PIXEL_FONT,
  fontSize: "8px",
  lineHeight: 1.5,
  imageRendering: "pixelated",
};

const portraitBaseStyle = {
  width: `${PORTRAIT_DISPLAY_SIZE}px`,
  height: `${PORTRAIT_DISPLAY_SIZE}px`,
  flexShrink: 0,
  borderWidth: "2px",
  borderStyle: "solid",
  backgroundColor: "#f3d9ca",
  imageRendering: "pixelated",
  backgroundRepeat: "no-repeat",
};

const bubbleTextStyle = {
  minWidth: 0,
  wordBreak: "break-word",
};

const bubbleKindStripStyle = {
  fontSize: "6px",
  letterSpacing: "0.08em",
  marginBottom: "4px",
  opacity: 0.85,
};

const bannerBaseStyle = {
  position: "absolute",
  bottom: "8px",
  left: "50%",
  transform: "translateX(-50%)",
  borderRadius: "4px",
  padding: "8px 12px",
  fontFamily: PIXEL_FONT,
  fontSize: "9px",
  lineHeight: 1.5,
  maxWidth: "80%",
  imageRendering: "pixelated",
};

// Dedicated right column — never shrink below a readable width.
const chatPaneStyle = {
  flex: "0 0 clamp(280px, 32vw, 420px)",
  width: "clamp(280px, 32vw, 420px)",
  minWidth: "280px",
  display: "flex",
  flexDirection: "column",
  background: "linear-gradient(180deg, #0c0c10 0%, #14141a 100%)",
  borderLeft: "1px solid #2a2a32",
  color: "#e8e8ec",
  fontFamily: '"IBM Plex Sans", "Segoe UI", system-ui, sans-serif',
  overflow: "hidden",
};

const chatHeaderStyle = {
  padding: "12px 14px",
  borderBottom: "1px solid #2a2a32",
  fontFamily: PIXEL_FONT,
  fontSize: "9px",
  letterSpacing: "0.04em",
  color: "#c8c0a8",
  background: "rgba(0, 0, 0, 0.22)",
};

const chatListStyle = {
  listStyle: "none",
  margin: 0,
  padding: "12px 14px",
  overflowY: "auto",
  flex: 1,
  minHeight: 0,
  display: "flex",
  flexDirection: "column",
  gap: "12px",
};

const chatEmptyStyle = {
  padding: "16px 14px",
  color: "#998ba0",
  fontSize: "13px",
};

const chatFiltersStyle = {
  display: "flex",
  gap: "8px",
  padding: "10px 14px",
  borderBottom: "1px solid #2a2a32",
  background: "rgba(0, 0, 0, 0.14)",
};

const chatFilterSelectStyle = {
  flex: 1,
  minWidth: 0,
  background: "#1a1a1e",
  color: "#e8e8ec",
  border: "1px solid #2a2a32",
  borderRadius: "4px",
  padding: "5px 6px",
  fontSize: "12px",
  fontFamily: '"IBM Plex Sans", "Segoe UI", system-ui, sans-serif',
};

const leakedBadgeStyle = {
  color: "#e74c3c",
  fontSize: "9px",
  fontWeight: 700,
  letterSpacing: "0.04em",
  border: "1px solid #e74c3c",
  borderRadius: "999px",
  padding: "1px 6px",
};

const leakButtonStyle = {
  marginLeft: "auto",
  fontSize: "10px",
  padding: "2px 8px",
  background: "#c0392b",
  color: "#ffffff",
  border: "1px solid #7a2317",
  borderRadius: "4px",
  cursor: "pointer",
};

const TYPE_FILTER_OPTIONS = [
  { value: "all", label: "All types" },
  { value: "public", label: "Public" },
  { value: "private", label: "Private" },
  { value: "confession", label: "Confession" },
  { value: "gm", label: "GM" },
  { value: "narration", label: "Narration" },
  { value: "leak", label: "Leak" },
];

function truncate(text) {
  if (text.length <= BUBBLE_TEXT_MAX_LENGTH) return text;
  return `${text.slice(0, BUBBLE_TEXT_MAX_LENGTH)}…`;
}

/** Stable color per character; GM / narrator get fixed accents. */
export function colorForSender(senderId, characterIds) {
  if (!senderId || senderId === "game_master") return "#c99b52";
  if (senderId === "narrator") return "#94a3b8";
  const index = characterIds.indexOf(senderId);
  if (index < 0) return "#b5a5bd";
  return SENDER_PALETTE[index % SENDER_PALETTE.length];
}

/** @deprecated Prefer speechLabelFromEvent from speechStyles.js */
export function chatKindLabel(event) {
  return speechLabelFromEvent(event);
}

export function chatSenderName(senderId, charactersById) {
  if (!senderId) return "Unknown";
  if (senderId === "game_master") return "Game Master";
  if (senderId === "narrator") return "Narrator";
  return charactersById.get(senderId)?.name || senderId;
}

/** Short label for above-head nameplates. */
export function shortCharacterName(name) {
  if (!name) return "?";
  return name.trim().split(/\s+/)[0] || "?";
}

/** Position a nameplate centered above a character sprite. */
export function characterNamePlacement(pixelX, pixelY) {
  const mapW = MAP_WIDTH * TILE_SIZE;
  const mapH = MAP_HEIGHT * TILE_SIZE;
  const left = ((pixelX + TILE_SIZE / 2) / mapW) * 100;
  const top = (pixelY / mapH) * 100;
  return {
    left: `${left}%`,
    top: `${top}%`,
    transform: "translate(-50%, calc(-100% - 6px))",
  };
}

function nameplateStyle(color) {
  return {
    position: "absolute",
    fontFamily: PIXEL_FONT,
    fontSize: "7px",
    lineHeight: 1.4,
    color,
    background: "rgba(10, 10, 14, 0.78)",
    border: `1px solid ${color}`,
    borderRadius: "3px",
    padding: "3px 6px",
    whiteSpace: "nowrap",
    maxWidth: "120px",
    overflow: "hidden",
    textOverflow: "ellipsis",
    textShadow: "0 1px 0 rgba(255,255,255,0.9)",
    boxShadow: `0 2px 0 rgba(110, 86, 119, 0.12), 0 0 6px ${color}55`,
    pointerEvents: "none",
  };
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

function tailStyles(flipBelow, tailOffsetPct, borderColor, fillColor) {
  if (flipBelow) {
    return {
      outer: {
        width: 0,
        height: 0,
        borderLeft: "7px solid transparent",
        borderRight: "7px solid transparent",
        borderBottom: `10px solid ${borderColor}`,
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
        borderBottom: `8px solid ${fillColor}`,
      },
    };
  }

  return {
    outer: {
      width: 0,
      height: 0,
      borderLeft: "7px solid transparent",
      borderRight: "7px solid transparent",
      borderTop: `10px solid ${borderColor}`,
      marginTop: "-2px",
      position: "relative",
      left: `${tailOffsetPct}%`,
    },
    inner: {
      position: "absolute",
      left: "-5px",
      top: "-10px",
      width: 0,
      height: 0,
      borderLeft: "5px solid transparent",
      borderRight: "5px solid transparent",
      borderTop: `8px solid ${fillColor}`,
    },
  };
}

function bubbleBodyStyleFor(kind) {
  const style = SPEECH_STYLES[kind];
  return {
    ...bubbleBodyBaseStyle,
    background: style.bubbleBg,
    color: style.bubbleFg,
    border: `2px ${style.bubbleBorderStyle} ${style.bubbleBorder}`,
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
  const [nameFilter, setNameFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [pendingLeak, setPendingLeak] = useState(null);
  const [leaking, setLeaking] = useState(false);
  const [leakError, setLeakError] = useState(null);

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
          setChatLog((prev) => {
            const next = event.leaked_from_seq != null
              ? prev.map((e) => (e.seq === event.leaked_from_seq ? { ...e, released: true } : e))
              : prev;
            return [...next, event];
          });
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

  const nameOptions = useMemo(() => {
    const seen = new Map();
    for (const event of chatLog) {
      const id = event.sender_id || "";
      if (!seen.has(id)) seen.set(id, chatSenderName(id, charactersById));
    }
    return [...seen.entries()];
  }, [chatLog, charactersById]);

  const filteredChatLog = chatLog.filter((event) => {
    if (nameFilter !== "all" && (event.sender_id || "") !== nameFilter) return false;
    if (typeFilter !== "all" && speechKindFromEvent(event) !== typeFilter) return false;
    return true;
  });

  function handleLeakClick(event) {
    setLeakError(null);
    setPendingLeak({ seq: event.seq, text: event.text });
  }

  function handleCancelLeak() {
    setPendingLeak(null);
    setLeakError(null);
  }

  async function handleConfirmLeak() {
    if (!pendingLeak) return;
    setLeaking(true);
    setLeakError(null);
    try {
      const updated = await leakEvent(showId, pendingLeak.seq);
      setChatLog((prev) => prev.map((event) => (
        event.seq === updated.seq ? { ...event, released: updated.released } : event
      )));
      setPendingLeak(null);
    } catch (error) {
      setLeakError(error.message || "Failed to leak message");
    } finally {
      setLeaking(false);
    }
  }

  if (loadError) {
    return (
      <div style={shellStyle}>
        <p role="alert">World assets failed to load: {loadError}</p>
      </div>
    );
  }

  return (
    <div style={shellStyle} data-testid="world-shell">
      <div style={gameAreaStyle} data-testid="world-game-area">
        <div style={frameStyle}>
          <canvas
            ref={canvasRef}
            width={MAP_WIDTH * TILE_SIZE}
            height={MAP_HEIGHT * TILE_SIZE}
            style={canvasStyle}
            data-testid="world-canvas"
          />
          <div style={overlayStyle}>
          {frame.characters.filter((c) => !c.bubble).map((c) => {
            const character = charactersById.get(c.id);
            const senderColor = colorForSender(c.id, characterIds);
            const label = shortCharacterName(character?.name || c.id);
            const placement = characterNamePlacement(c.pixelX, c.pixelY);
            return (
              <div
                key={`name-${c.id}`}
                data-testid={`nameplate-${c.id}`}
                data-sender={c.id}
                data-sender-color={senderColor}
                style={{
                  ...nameplateStyle(senderColor),
                  ...placement,
                }}
              >
                {label}
              </div>
            );
          })}
          {frame.characters.filter((c) => c.bubble).map((c) => {
            const spriteKey = charactersById.get(c.id)?.spriteKey;
            const placement = bubblePlacement(c.pixelX, c.pixelY);
            const speechKind = speechKindFromBubble(c.bubble.kind);
            const speechStyle = SPEECH_STYLES[speechKind];
            const tail = tailStyles(
              placement.flipBelow,
              placement.tailOffsetPct,
              speechStyle.bubbleBorder,
              speechStyle.tailFill,
            );
            return (
              <div
                key={c.id}
                data-testid={`bubble-${c.id}`}
                data-speech-kind={speechKind}
                data-placement={placement.flipBelow ? "below" : "above"}
                style={{
                  ...bubbleShellStyle,
                  left: `${placement.left}%`,
                  top: `${placement.top}%`,
                  transform: placement.transform,
                }}
              >
                <div style={bubbleBodyStyleFor(speechKind)}>
                  {spriteKey && (
                    <div
                      data-testid={`bubble-portrait-${c.id}`}
                      aria-hidden="true"
                      style={{
                        ...portraitBaseStyle,
                        borderColor: speechStyle.bubbleBorder,
                        ...portraitBackground(characterAssetUrl(spriteKey)),
                      }}
                    />
                  )}
                  <div style={bubbleTextStyle}>
                    <div
                      data-testid={`bubble-kind-${c.id}`}
                      style={{
                        ...bubbleKindStripStyle,
                        color: speechStyle.bubbleBorder,
                      }}
                    >
                      {speechStyle.label}
                    </div>
                    {truncate(c.bubble.text)}
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
          <div
            style={{
              ...bannerBaseStyle,
              background: SPEECH_STYLES.gm.bubbleBg,
              color: SPEECH_STYLES.gm.bubbleFg,
              border: `2px solid ${SPEECH_STYLES.gm.bubbleBorder}`,
            }}
            data-testid="gm-banner"
            data-speech-kind="gm"
          >
            <div
              style={{
                fontSize: "7px",
                letterSpacing: "0.08em",
                color: SPEECH_STYLES.gm.bubbleBorder,
                marginBottom: "4px",
              }}
            >
              {SPEECH_STYLES.gm.label}
            </div>
            {frame.gmBanner.text}
          </div>
        )}
        </div>
      </div>

      <aside style={chatPaneStyle} data-testid="world-chat" aria-label="Full chat log">
        <div style={chatHeaderStyle}>Full chat</div>
        <div style={chatFiltersStyle} data-testid="chat-filters">
          <select
            aria-label="Filter by name"
            data-testid="chat-filter-name"
            value={nameFilter}
            onChange={(e) => setNameFilter(e.target.value)}
            style={chatFilterSelectStyle}
          >
            <option value="all">All names</option>
            {nameOptions.map(([id, name]) => (
              <option key={id} value={id}>{name}</option>
            ))}
          </select>
          <select
            aria-label="Filter by type"
            data-testid="chat-filter-type"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            style={chatFilterSelectStyle}
          >
            {TYPE_FILTER_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
        {chatLog.length === 0 ? (
          <p style={chatEmptyStyle}>
            The house is quiet. Show yet to start — stay tuned.
          </p>
        ) : filteredChatLog.length === 0 ? (
          <p style={chatEmptyStyle} data-testid="chat-filter-empty">
            No messages match these filters.
          </p>
        ) : (
          <ul style={chatListStyle}>
            {filteredChatLog.map((event, index) => {
              const senderColor = colorForSender(event.sender_id, characterIds);
              const speechKind = speechKindFromEvent(event);
              const card = chatCardStyles(senderColor, speechKind);
              const to = recipientNames(event, charactersById);
              const key = event.seq != null ? `seq-${event.seq}` : `idx-${index}`;
              const isLeakable = speechKind === "private" || speechKind === "confession";
              const canLeak = isLeakable && !event.released;
              return (
                <li
                  key={key}
                  data-testid={`chat-entry-${key}`}
                  data-speech-kind={speechKind}
                  data-sender={event.sender_id || ""}
                  data-sender-color={senderColor}
                  data-kind={event.kind || ""}
                  data-visibility={event.visibility || ""}
                  style={{ ...card.container, flexShrink: 0 }}
                >
                  <div style={card.header}>
                    <span style={card.sender}>
                      {chatSenderName(event.sender_id, charactersById)}
                    </span>
                    <span
                      data-testid={`chat-kind-${key}`}
                      style={card.typeBadge}
                    >
                      {speechLabelFromEvent(event)}
                    </span>
                    {isLeakable && event.released && (
                      <span data-testid={`chat-leaked-badge-${key}`} style={leakedBadgeStyle}>
                        LEAKED
                      </span>
                    )}
                    {to && (
                      <span style={card.recipient}>
                        → {to}
                      </span>
                    )}
                    {canLeak && (
                      <button
                        type="button"
                        data-testid={`leak-button-${key}`}
                        style={leakButtonStyle}
                        onClick={() => handleLeakClick(event)}
                      >
                        Leak
                      </button>
                    )}
                  </div>
                  <div
                    data-testid={`chat-text-${key}`}
                    style={card.body}
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
      {pendingLeak && (
        <LeakConfirmDialog
          text={pendingLeak.text}
          error={leakError}
          pending={leaking}
          onConfirm={handleConfirmLeak}
          onCancel={handleCancelLeak}
        />
      )}
    </div>
  );
}

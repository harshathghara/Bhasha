/** @typedef {'public' | 'private' | 'confession' | 'gm' | 'narration' | 'leak'} SpeechKind */

export const SPEECH_STYLES = {
  public: {
    label: "PUBLIC",
    bubbleBg: "#ffffff",
    bubbleFg: "#000000",
    bubbleBorder: "#111111",
    bubbleBorderStyle: "solid",
    tailFill: "#ffffff",
    chatBg: "#1a1a1e",
    chatFg: "#e8e8ec",
    chatAccent: "#8a8a96",
  },
  private: {
    label: "PRIVATE",
    bubbleBg: "#e8f3fb",
    bubbleFg: "#1a3a52",
    bubbleBorder: "#4a8ac6",
    bubbleBorderStyle: "dashed",
    tailFill: "#e8f3fb",
    chatBg: "#1a1a1e",
    chatFg: "#e8e8ec",
    chatAccent: "#8a8a96",
  },
  confession: {
    label: "CONFESSION",
    bubbleBg: "#fbe8f1",
    bubbleFg: "#4a2d3e",
    bubbleBorder: "#c4699b",
    bubbleBorderStyle: "solid",
    tailFill: "#fbe8f1",
    chatBg: "#1a1a1e",
    chatFg: "#e8e8ec",
    chatAccent: "#8a8a96",
  },
  gm: {
    label: "GM",
    bubbleBg: "#2a2a32",
    bubbleFg: "#e8e8ec",
    bubbleBorder: "#8a8a96",
    bubbleBorderStyle: "solid",
    tailFill: "#2a2a32",
    chatBg: "#1a1a1e",
    chatFg: "#e8e8ec",
    chatAccent: "#8a8a96",
  },
  narration: {
    label: "NARRATION",
    bubbleBg: "#f0f0f0",
    bubbleFg: "#333333",
    bubbleBorder: "#999999",
    bubbleBorderStyle: "solid",
    tailFill: "#f0f0f0",
    chatBg: "#1a1a1e",
    chatFg: "#e8e8ec",
    chatAccent: "#8a8a96",
  },
  leak: {
    label: "LEAKED",
    bubbleBg: "#c0392b",
    bubbleFg: "#ffffff",
    bubbleBorder: "#7a2317",
    bubbleBorderStyle: "solid",
    tailFill: "#c0392b",
    chatBg: "#1a1a1e",
    chatFg: "#e8e8ec",
    chatAccent: "#e74c3c",
  },
};

/**
 * @param {{ kind?: string, visibility?: string }} event
 * @returns {SpeechKind}
 */
export function speechKindFromEvent(event) {
  if (event.kind === "leak") return "leak";
  if (event.kind === "confession") return "confession";
  if (event.kind === "gm_ruling" || event.kind === "gm_announcement") return "gm";
  if (event.kind === "narration") return "narration";
  if (event.kind === "agent_action" && event.visibility === "private") return "private";
  if (event.kind === "agent_action" && event.visibility === "public") return "public";
  if (event.visibility === "private") return "private";
  return "public";
}

/**
 * @param {string | undefined} kind
 * @returns {SpeechKind}
 */
export function speechKindFromBubble(kind) {
  if (kind && kind in SPEECH_STYLES) return /** @type {SpeechKind} */ (kind);
  return "public";
}

/**
 * @param {{ kind?: string, visibility?: string }} event
 * @returns {string}
 */
export function speechLabelFromEvent(event) {
  if (event.kind === "gm_ruling") return "GM RULING";
  const kind = speechKindFromEvent(event);
  return SPEECH_STYLES[kind].label;
}

/** @param {string} hex @param {number} alpha */
export function hexWithAlpha(hex, alpha) {
  const normalized = hex.replace("#", "");
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Sidebar card styling that pairs a speaker accent with speech-type flair.
 * @param {string} senderColor
 * @param {SpeechKind} kind
 */
export function chatCardStyles(senderColor, kind) {
  const speech = SPEECH_STYLES[kind];
  return {
    container: {
      borderLeft: `3px solid ${senderColor}`,
      flexShrink: 0,
      paddingLeft: "10px",
    },
    header: {
      display: "flex",
      flexWrap: "wrap",
      gap: "6px",
      alignItems: "baseline",
      marginBottom: "4px",
      fontSize: "11px",
      lineHeight: 1.3,
    },
    sender: {
      color: senderColor,
      fontWeight: 700,
      fontSize: "13px",
    },
    typeBadge: {
      color: speech.chatAccent,
      textTransform: "uppercase",
      letterSpacing: "0.04em",
      fontSize: "10px",
    },
    recipient: {
      color: speech.chatAccent,
      fontSize: "11px",
    },
    body: {
      color: speech.chatFg,
      fontSize: "13px",
      lineHeight: 1.45,
      whiteSpace: "pre-wrap",
      wordBreak: "break-word",
    },
  };
}

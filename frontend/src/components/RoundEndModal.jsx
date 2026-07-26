import { useState } from "react";

const PIXEL_FONT = '"Press Start 2P", "VT323", monospace';

// Matches the centered game frame so the modal covers the world, not the chat.
const overlayStyle = {
  position: "absolute",
  top: "50%",
  left: "50%",
  transform: "translate(-50%, -50%)",
  width: "min(100vw, calc(100vh * 10 / 8))",
  height: "min(100vh, calc(100vw * 8 / 10))",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "rgba(112, 87, 122, 0.28)",
  zIndex: 3,
  padding: "24px",
  boxSizing: "border-box",
};

const panelStyle = {
  width: "min(100%, 420px)",
  maxHeight: "100%",
  display: "flex",
  flexDirection: "column",
  gap: "14px",
  background: "#16161c",
  border: "2px solid #2a2a32",
  borderRadius: "6px",
  padding: "20px 18px",
  color: "#e8e8ec",
  fontFamily: '"IBM Plex Sans", "Segoe UI", system-ui, sans-serif',
  boxSizing: "border-box",
};

const titleStyle = {
  margin: 0,
  fontFamily: PIXEL_FONT,
  fontSize: "11px",
  lineHeight: 1.5,
  color: "#c8c0a8",
  textAlign: "center",
};

const recapStyle = {
  margin: 0,
  maxHeight: "180px",
  overflowY: "auto",
  fontSize: "14px",
  lineHeight: 1.5,
  color: "#d8d8de",
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
};

const storyPanelStyle = {
  maxHeight: "200px",
  overflowY: "auto",
  display: "flex",
  flexDirection: "column",
  gap: "12px",
  borderTop: "1px solid #2a2a32",
  paddingTop: "12px",
};

const storyRoundStyle = {
  margin: 0,
  fontSize: "11px",
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  color: "#8a8a96",
};

const storyTextStyle = {
  margin: "4px 0 0",
  fontSize: "13px",
  lineHeight: 1.45,
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
};

const noteLabelStyle = {
  margin: 0,
  fontSize: "11px",
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  color: "#8a8a96",
};

const noteInputStyle = {
  width: "100%",
  minHeight: "72px",
  resize: "vertical",
  boxSizing: "border-box",
  margin: 0,
  padding: "10px 12px",
  border: "1px solid #3a3a44",
  borderRadius: "4px",
  background: "#0f0f14",
  color: "#e8e8ec",
  fontFamily: '"IBM Plex Sans", "Segoe UI", system-ui, sans-serif',
  fontSize: "13px",
  lineHeight: 1.45,
};

const actionsStyle = {
  display: "flex",
  flexWrap: "wrap",
  gap: "8px",
  justifyContent: "center",
};

const buttonStyle = {
  fontFamily: PIXEL_FONT,
  fontSize: "8px",
  lineHeight: 1.4,
  padding: "10px 12px",
  borderWidth: "2px",
  borderStyle: "solid",
  borderColor: "#111111",
  borderRadius: "4px",
  background: "#c8c0a8",
  color: "#111111",
  cursor: "pointer",
};

const secondaryButtonStyle = {
  ...buttonStyle,
  background: "#2a2a32",
  color: "#e8e8ec",
  borderColor: "#3a3a44",
};

const disabledButtonStyle = {
  ...buttonStyle,
  opacity: 0.45,
  cursor: "not-allowed",
};

export default function RoundEndModal({
  round,
  recap,
  narratives,
  storyOpen,
  showOver,
  starting,
  ending,
  onStartNext,
  onToggleStory,
  onEndGame,
}) {
  const [producerNote, setProducerNote] = useState("");
  const rounds = Object.keys(narratives || {})
    .map(Number)
    .sort((a, b) => a - b);

  return (
    <div style={overlayStyle} data-testid="round-end-modal" role="dialog" aria-labelledby="round-end-title">
      <div style={panelStyle}>
        <h2 id="round-end-title" style={titleStyle}>
          Round {round} ended
        </h2>

        {recap ? (
          <>
            <p style={{ ...storyRoundStyle, marginTop: 0 }}>Round recap</p>
            <p style={recapStyle} data-testid="round-end-recap">{recap}</p>
          </>
        ) : null}

        {storyOpen && (
          <div style={storyPanelStyle} data-testid="story-so-far">
            {rounds.length === 0 ? (
              <p style={{ margin: 0, color: "#8c7f93", fontSize: "13px" }}>
                No story chapters yet.
              </p>
            ) : (
              rounds.map((r) => (
                <div key={r}>
                  <p style={storyRoundStyle}>Round {r} — story</p>
                  <p style={storyTextStyle}>{narratives[r]}</p>
                </div>
              ))
            )}
          </div>
        )}

        {!showOver && (
          <label style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <span style={noteLabelStyle}>Producer note</span>
            <textarea
              data-testid="producer-note-input"
              value={producerNote}
              onChange={(event) => setProducerNote(event.target.value)}
              placeholder="Optional note for all agents and the GM…"
              disabled={starting}
              style={noteInputStyle}
            />
          </label>
        )}

        <div style={actionsStyle}>
          <button
            type="button"
            onClick={() => onStartNext(producerNote.trim())}
            disabled={starting || showOver}
            style={starting || showOver ? disabledButtonStyle : buttonStyle}
          >
            {showOver ? "Show over" : starting ? "Starting…" : "Start next round"}
          </button>
          <button
            type="button"
            onClick={onToggleStory}
            style={secondaryButtonStyle}
          >
            {storyOpen ? "Hide story" : "Story so far"}
          </button>
          {!showOver && (
            <button
              type="button"
              onClick={onEndGame}
              disabled={starting || ending}
              style={starting || ending ? disabledButtonStyle : secondaryButtonStyle}
            >
              {ending ? "Ending…" : "End game"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

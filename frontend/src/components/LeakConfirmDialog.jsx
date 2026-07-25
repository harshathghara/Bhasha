const PIXEL_FONT = '"Press Start 2P", "VT323", monospace';

const overlayStyle = {
  position: "fixed",
  inset: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "rgba(10, 10, 14, 0.72)",
  zIndex: 4,
  padding: "24px",
  boxSizing: "border-box",
};

const panelStyle = {
  width: "min(100%, 380px)",
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
  fontSize: "10px",
  lineHeight: 1.5,
  color: "#e74c3c",
  textAlign: "center",
};

const quoteStyle = {
  margin: 0,
  maxHeight: "140px",
  overflowY: "auto",
  fontSize: "14px",
  lineHeight: 1.5,
  color: "#d8d8de",
  fontStyle: "italic",
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  borderLeft: "3px solid #e74c3c",
  paddingLeft: "10px",
};

const errorStyle = {
  margin: 0,
  fontSize: "12px",
  color: "#e5788a",
};

const actionsStyle = {
  display: "flex",
  gap: "8px",
  justifyContent: "center",
};

const cancelButtonStyle = {
  fontFamily: PIXEL_FONT,
  fontSize: "8px",
  lineHeight: 1.4,
  padding: "10px 12px",
  borderWidth: "2px",
  borderStyle: "solid",
  borderColor: "#3a3a44",
  borderRadius: "4px",
  background: "#2a2a32",
  color: "#e8e8ec",
  cursor: "pointer",
};

const confirmButtonStyle = {
  ...cancelButtonStyle,
  background: "#c0392b",
  color: "#ffffff",
  borderColor: "#7a2317",
};

const disabledConfirmButtonStyle = {
  ...confirmButtonStyle,
  opacity: 0.45,
  cursor: "not-allowed",
};

export default function LeakConfirmDialog({ text, error, pending, onConfirm, onCancel }) {
  return (
    <div
      style={overlayStyle}
      data-testid="leak-confirm-dialog"
      role="dialog"
      aria-labelledby="leak-confirm-title"
    >
      <div style={panelStyle}>
        <h2 id="leak-confirm-title" style={titleStyle}>
          Leak this to the whole house?
        </h2>
        <p style={quoteStyle} data-testid="leak-confirm-text">
          &quot;{text}&quot;
        </p>
        {error && (
          <p style={errorStyle} role="alert" data-testid="leak-confirm-error">
            {error}
          </p>
        )}
        <div style={actionsStyle}>
          <button type="button" style={cancelButtonStyle} onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            style={pending ? disabledConfirmButtonStyle : confirmButtonStyle}
            disabled={pending}
            onClick={onConfirm}
          >
            {pending ? "Leaking…" : "Leak"}
          </button>
        </div>
      </div>
    </div>
  );
}

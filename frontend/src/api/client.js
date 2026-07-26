const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8000";

async function request(path, options) {
  const url = `${API_BASE}${path}`;
  const response = options
    ? await fetch(url, options)
    : await fetch(url);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const detail = body.detail;
    const message = Array.isArray(detail)
      ? detail.map((item) => item.msg || JSON.stringify(item)).join("; ")
      : (detail || `Request to ${path} failed (${response.status})`);
    throw new Error(typeof message === "string" ? message : JSON.stringify(message));
  }
  return response.json();
}

function post(path, body) {
  const options = { method: "POST" };
  if (body !== undefined) {
    options.headers = { "Content-Type": "application/json" };
    options.body = JSON.stringify(body);
  }
  return request(path, options);
}

export function createShow(payload) {
  return post("/shows", payload);
}

export function getShow(showId) {
  return request(`/shows/${showId}`);
}

export function startRound(showId, options = {}) {
  const opening = (options.opening_brief || "").trim();
  if (!opening) {
    return post(`/shows/${showId}/rounds`);
  }
  return post(`/shows/${showId}/rounds`, { opening_brief: opening });
}

export function stopRound(showId) {
  return post(`/shows/${showId}/stop`);
}

export function endShow(showId) {
  return post(`/shows/${showId}/end`);
}

export function killAgent(showId, agentId) {
  return post(`/shows/${showId}/agents/${agentId}/kill`);
}

export function releaseEvent(showId, seq) {
  return post(`/shows/${showId}/events/${seq}/release`);
}

export function leakEvent(showId, seq) {
  return post(`/shows/${showId}/events/${seq}/leak`);
}

export function injectEvent(showId, text) {
  return post(`/shows/${showId}/events`, { text });
}

export function openEventSocket(showId, onEvent) {
  const url = `${API_BASE.replace(/^http/, "ws")}/ws/${showId}`;
  const socket = new WebSocket(url);
  socket.onmessage = (message) => onEvent(JSON.parse(message.data));
  return socket;
}

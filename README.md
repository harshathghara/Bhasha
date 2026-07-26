# Sheesha Ghar

An AI reality-show simulation. Five LLM-driven characters are locked in a
house with one dead man and one killer among them, and they must talk,
scheme, and betray each other in public and in private until the house
pins the blame on someone. A Game Master agent enforces house rules, a
narrator writes each round's recap, and a human "producer" (you) can watch
the whole thing live and even leak a private secret to the whole house
mid-game to see how the cast reacts.

The default show, "Sheesha Ghar: Who Takes the Blame?", is a murder-blame
game: Ramesh Malhotra is dead, and his wife, brother, lawyer, creditor, and
househelp must figure out — or successfully pin — who takes the fall. The
show premise, house rules, and cast personalities are all configurable per
show (see [Creating a show](#creating-a-show)).

## How it works

- **Contestants** are LLM agents, each given a personality prompt and a set
  of tools: speak publicly, send a private message, record a confession
  (visible only to the audience/GM), leak a private message or confession
  they witnessed, or stay silent.
- **The Game Master** is a separate LLM agent that watches everything —
  including private traffic and confessions — and can warn, eject, publicly
  announce, or end the round.
- **The narrator** writes a short producer recap and a longer prose story
  chapter for each round once it ends.
- **Leaking** is the twist: a private message or confession can be revealed
  to the whole house as a public announcement, either by a human producer
  clicking "Leak" in the UI, or by an agent autonomously deciding to expose
  something it personally witnessed. Once revealed, every agent's context
  treats it as common knowledge and can react to it — some characters (like
  Meena the Househelp) are specifically written to call it out by name.
- Everything is event-sourced: every line spoken, private message, leak, and
  ruling is a single `Event` on a per-show log, streamed live to the
  frontend over a WebSocket.

## Project layout

```
backend/    FastAPI game engine + HTTP/WebSocket API
frontend/   React + Vite UI (show setup, live 2D world view, chat sidebar)
docs/       Design specs and implementation plans for each feature (history)
```

## Backend

**Stack:** FastAPI, uvicorn, the `openai` Python SDK (also used against Groq,
since Groq exposes an OpenAI-compatible endpoint), pytest.

### Setup

```bash
cd backend
pip install -r requirements.txt
cp .env.example .env
```

Edit `.env`:

```
LLM_PROVIDER=openai            # openai or groq
LLM_MODEL=gpt-4o-mini          # or e.g. openai/gpt-oss-120b for groq
OPENAI_API_KEY=
GROQ_API_KEY=
```

Only the API key matching your chosen `LLM_PROVIDER` is required. Startup
fails fast with a clear error if the provider is unrecognized or the
matching key is missing.

### Run

```bash
cd backend
uvicorn app.main:app --reload
```

Serves on `http://localhost:8000` by default (matching the frontend's
default API base). Run it from inside `backend/` — snapshots are written
to `backend/snapshots/<show_id>.json` after every round, relative to the
process's working directory.

**Shows are in-memory only.** Restarting the server clears every show;
there is no persistence beyond the per-round JSON snapshots.

### Tests

```bash
cd backend
pytest
```

112 tests across `backend/tests/`, covering the event bus, agent/GM loops,
round supervisor, narrator, presets, LLM config, and the full HTTP API.

### Module map (`backend/app/`)

| Module | Purpose |
|---|---|
| `main.py` | Entrypoint: loads `.env`, builds the store and LLM client, creates the app. |
| `api.py` | All FastAPI routes and the WebSocket endpoint (see [API](#http--websocket-api)). |
| `models.py` | Core dataclasses/enums: `Event`, `Agent`, `Show`, `RoundConfig`, `EventKind`, `Visibility`. |
| `event_bus.py` | Per-show pub/sub (`EventBus`), visibility rules, and `perform_leak()` — the core leak mechanic. |
| `agent_loop.py` | Per-agent async loop: builds each agent's prompt from what it can see, calls the LLM, dispatches its tool calls. |
| `gm_loop.py` | The Game Master's async loop: batches events, periodically rules on them. |
| `supervisor.py` | `run_round`: orchestrates agent loops + GM loop + round-end conditions (timeout, budget exhaustion, quiescence), then narrates and snapshots. |
| `narrator.py` | Post-round LLM narration: a short recap and a longer story chapter. |
| `presets.py` | The default show premise, GM prompt, house rules, and the five murder-cast character personalities. |
| `tools.py` | OpenAI-style function-calling schemas for agents (`AGENT_TOOLS`) and the GM (`GM_TOOLS`). |
| `llm_client.py` | Thin wrapper over the `openai` SDK for plain completions and tool-calling completions. |
| `llm_config.py` | Resolves `LLM_PROVIDER`/`LLM_MODEL`/API key from the environment. |
| `store.py` | In-memory show store plus per-round JSON snapshotting. |

### HTTP + WebSocket API

| Method & path | Description |
|---|---|
| `POST /shows` | Create a show. Requires exactly 5 `agent_preset_ids`; optional `secret_connections` between two agents. Returns the created show. |
| `GET /shows/{show_id}` | Full current state of a show. |
| `POST /shows/{show_id}/rounds` | Run one round to completion; returns `{round, recap, narrative}`. 409 once `max_rounds` is reached. |
| `POST /shows/{show_id}/stop` | Signal the in-progress round to end early. |
| `POST /shows/{show_id}/end` | Force-end the show. |
| `POST /shows/{show_id}/agents/{agent_id}/kill` | Manually eliminate a contestant. |
| `POST /shows/{show_id}/events` | Producer injects a public clue/note into the live log. |
| `POST /shows/{show_id}/events/{seq}/release` | Mark an event released (visible to everyone) without a leak announcement. |
| `POST /shows/{show_id}/events/{seq}/leak` | Reveal a private message/confession as a public leak announcement. 404 if the event doesn't exist, 409 if it isn't leakable or was already leaked. |
| `WS /ws/{show_id}` | Live stream of every new event for that show as it's published. |

Agents can also trigger a leak themselves, in-band, via the `leak_message`
tool — functionally the same mechanism as the HTTP endpoint above, just
self-attributed instead of producer-attributed.

## Frontend

**Stack:** React 18, Vite 5, Vitest + Testing Library. No router or global
state library — a single top-level state machine in `App.jsx` switches
from show setup to the live world view.

### Setup & run

```bash
cd frontend
npm install
npm run dev
```

Serves on `http://localhost:5173` by default. It talks directly to the
backend at `http://localhost:8000` (override with a `VITE_API_BASE` env
var); the backend has CORS wide open, so no dev-server proxy is needed.

```bash
npm run build   # production build
npm test        # run the test suite
```

134 tests across every component and every `world/` module, plus the API
client.

### Structure (`frontend/src/`)

| Path | Purpose |
|---|---|
| `App.jsx` | Top-level state machine: show setup → live world page. |
| `api/client.js` | HTTP client wrapping every backend endpoint above. |
| `components/ShowSetup.jsx` | Pre-game screen: pick 5 presets, prompts, secret connections. |
| `components/WorldView.jsx` | The live 2D world + chat sidebar, with name/type filters and the Leak button. |
| `components/LeakConfirmDialog.jsx` | Confirmation modal before leaking a private event. |
| `components/RoundEndModal.jsx` | End-of-round recap and story display. |
| `components/EventFeed.jsx` / `LiveRoom.jsx` | Event log / live-round views. |
| `pages/WorldPage.jsx` | Composes the world view and round controls, driven by the WebSocket stream. |
| `world/` | Canvas/sprite rendering engine: map, movement, pathfinding, sprites, speech-bubble styling, and the mapping from backend events to in-world behavior. |

## Design history

`docs/superpowers/specs/` and `docs/superpowers/plans/` hold the paired
design spec + implementation plan for every feature built so far (the core
harness, the murder-blame rewrite, the gamified world UI, producer notes,
chat filters and the leak feature, and more). Useful as a record of *why*
things are the way they are, not required reading to get started.

## Known limitations

- No persistence beyond in-memory shows and per-round JSON snapshots —
  a server restart clears everything.
- No auth — this is a local/single-viewer producer tool, not a
  multi-tenant service.
- Backend and frontend are started as two separate processes; there is no
  combined dev script yet.

# Between-Round Producer Brief — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Optional `opening_brief` on Start round publishes a public `producer_note` after the default kickoff (option B).

**Architecture:** Extend `POST /rounds` body → `run_round(..., opening_brief)` publishes second event → LiveRoom text field + `startRound(id, { opening_brief })`.

**Tech Stack:** FastAPI, existing EventBus/`PRODUCER_NOTE`, React LiveRoom, vitest/pytest.

---

### Task 1: Backend brief on round start

**Files:** `backend/app/supervisor.py`, `backend/app/api.py`, `backend/tests/test_api.py`, `backend/tests/test_supervisor.py`

- [ ] `run_round` accepts `opening_brief`; after kickoff publish non-empty stripped text as `PRODUCER_NOTE`
- [ ] API: optional body `{ opening_brief?: str }`
- [ ] Tests: empty = kickoff only; with text = kickoff then producer_note on new round; two rounds → two narratives

### Task 2: Frontend Start-round brief UI

**Files:** `frontend/src/api/client.js`, `client.test.js`, `LiveRoom.jsx`, `LiveRoom.test.jsx`

- [ ] `startRound(showId, { opening_brief }?)`
- [ ] Optional “Round brief” field; clear after successful start

### Task 3: Multi-round verification

- [ ] Automated: two consecutive rounds accumulate narratives + brief on round 2
- [ ] Live/scripted user path against running server if available

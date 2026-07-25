# Sheesha Ghar — AI Reality Show: Design Spec

Hackathon target: 4-person team, 1.5 days. Goal is a working end-to-end vertical
slice, not the full feature list from the original brief. Everything under
"Stretch goals" is cut unless core is done early.

## 1. What this is

An AI reality show where 5 LLM-driven agents, each with a distinct personality,
interact in rounds inside a house governed by user-defined rules. A Game
Master agent enforces those rules. Viewers see a live chat feed and a
narrated story; agents only see what they'd realistically know.

## 2. Prompt surfaces (the part the user fills in)

The harness ships with **defaults** for every one of these so the app runs
out of the box, but each is a swappable prompt/config the producer (user)
supplies before or during a show:

| Surface | What it controls | Where it lives |
|---|---|---|
| Show definition prompt | Premise, rules, boundaries, end condition | `shows/{show_id}/config.json` → `show_prompt` |
| Agent personality prompt (x8-10 in the pool) | Each preset personality's voice, values, goals | `agents/presets/*.json` → `personality_prompt` |
| Game Master personality prompt | How strict/lenient/dramatic the GM is, its own "voice" | `shows/{show_id}/config.json` → `gm_prompt` |
| Per-round producer note (optional) | Twist/guidance injected before a round, group-wide or targeted at one agent | submitted at runtime via API, stored in round log |

Defaults: a generic reality-show ruleset, 8 preset personalities (archetypes
like strategist/diplomat/wildcard/manipulator/loyalist/etc.), and a neutral
"fair but firm" GM prompt. The user edits/replaces these via the frontend
before starting a show; nothing is hardcoded elsewhere in the pipeline.

## 3. Architecture

Single-process FastAPI backend, in-memory state, WebSocket push to a React
frontend. No external queue or DB for the hackathon — state is dumped to a
JSON file after each round as a crash safety net.

```
React frontend  <── WebSocket + REST ──>  FastAPI backend
                                              │
                                       Show Orchestrator (in-memory)
                                              │
                        ┌─────────────┬───────┴───────┬─────────────┐
                    Agent Runner  GM Runner      Narrator Runner   State Store
                   (OpenAI calls,  (OpenAI call,  (OpenAI call,    (Python objects
                    parallel per   post-round)     post-GM)         + JSON snapshot)
                    active agent)
```

## 4. Core data model

```
Show
  id, title, show_prompt, gm_prompt, rules_text
  status: setup | running | paused | ended
  current_round: int
  max_rounds: int | None      # optional producer-set cap; None = unlimited, ends manually
  stages: [Stage]            # optional, see §8
  contestants: [Agent]

Agent
  id, name, personality_prompt (from preset, editable)
  status: active | warned | paused | eliminated
  private_memory: [str]       # agent's own running summary/notes
  warnings: int

Message
  id, round, sender_id
  visibility: "public" | "private"
  recipients: [agent_id]       # only when private
  released: bool                # true once leaked/made public
  text
  kind: "action" | "gm_ruling" | "narration"

RoundLog
  round_number, messages: [Message], narrative: str
```

## 5. Round lifecycle

1. **Snapshot context per agent**: for each active, non-paused agent, build
   its context = personality_prompt + own private_memory + all public
   messages so far (incl. released ones) + private messages where it is
   sender/recipient + any producer note targeted at it or the group.
2. **Parallel agent calls**: `asyncio.gather` one OpenAI call per active
   agent. Each call returns: one public action (required) and zero or more
   private messages to named recipients, and optionally a "leak" flag on a
   past private message it received (agent chooses to make it public).
3. **Collect & resolve**: append public actions to the public log in fixed
   agent order. File private messages into recipient inboxes for round N+1.
   Any leaked message is marked `released = true` immediately and enters the
   public log at this point.
4. **GM review**: one OpenAI call, given `gm_prompt` + full round content
   (public + private, full visibility) + rules_text. Returns: allow, or a
   ruling (warn / eliminate) per agent, as a `gm_ruling` message (always
   public).
5. **Narrator pass**: one OpenAI call, given only public actions + GM
   rulings from this round (never unreleased private content), returns a
   short story paragraph appended to the show's story feed.
6. **Broadcast**: push the round's public messages + GM rulings + narrative
   over WebSocket. Private messages are pushed only to the producer/viewer
   channel (see §6), never filtered into any agent's own next-round context
   until released.
7. Advance `current_round`; wait for the next "Advance Round" trigger (user
   button) or stage-driven auto-pause (§8).

Eliminated agents are skipped in step 1-2 permanently. Paused agents are
skipped in step 1-2 for the rounds they're paused, but their state persists.

## 6. Two audiences, one log

- **Agent context** (fed to LLM calls): filtered per §5 step 1. This is the
  in-world knowledge boundary.
- **Viewer feed / story** (frontend "Live Round Feed" + "Full Story" tabs):
  unfiltered — every public action, every private message (labeled
  "viewers only"), every leak, every GM ruling, in full. Viewers are always
  omniscient; this is the core entertainment mechanic (see mockup:
  `glass-house-mockup.html`).
- The producer control panel uses the same unfiltered feed as the viewer
  (no separate "god mode" needed — producer *is* a viewer with extra
  buttons).

## 7. Agent lifecycle controls

- **Pause**: sets `status = paused`. Skipped in round execution; resumes on
  user action. Used for "user needs to interact/change a rule" moments.
- **Kill (remove)**: sets `status = eliminated`. Permanent; excluded from
  all future rounds. Triggered by user manually, or by GM ruling
  (`eliminate` verdict) — GM has authority to do this unilaterally within
  its `gm_prompt`-defined judgment.
- **Warn**: GM-only outcome; increments `warnings`, no functional lockout,
  but included in that agent's own context so it "knows" it's on notice.

## 8. Stages (stretch goal, build only if core loop is solid early)

A `Stage` is `{name, end_criteria_text}`. When defined, the round loop
checks stage end criteria after each round via a lightweight LLM check
("has this stage's end criteria been met, given the round log?"); if yes,
show auto-transitions to `status = paused` with a "stage complete" banner,
and waits for the user to start the next stage. Stages are optional — a
show with none just runs continuous rounds until manually ended.

## 9. Frontend (React)

Screens, in priority order:

1. **Show Setup** — show_prompt textarea, gm_prompt textarea, rules_text,
   pick 5 of the preset agent pool (editable personality_prompt per pick).
2. **Live Room** — the two-tab view from the mockup: Live Round Feed
   (per-round chat, POV toggle optional/stretch) + Full Story tab. Roster
   sidebar with status pills. "Advance Round" button. Producer note input
   (group-wide; per-agent targeting is stretch).
3. **Controls** — pause/resume/kill buttons per agent, visible inline in
   the roster sidebar.

## 10. Build order for 1.5 days (4 people)

1. Data model + in-memory Show/Agent/Message classes + JSON snapshot (own by 1 person).
2. Agent Runner + OpenAI integration + parallel round execution (own by 1 person).
3. GM Runner + Narrator Runner, chained after round resolution (own by 1 person).
4. FastAPI routes + WebSocket broadcast + React frontend (own by 1 person, can start against a mocked API contract in parallel with #1-3).

## 11. Explicit MVP cut list (stretch only, in this order)

1. Stage/phase system (§8).
2. Per-agent-targeted producer notes (group-wide only in MVP).
3. Mid-show rule-editing UI (rules_text is set once at show creation for MVP;
   editing it is just re-running Show Setup pre-launch).
4. POV toggle in the live viewer UI (nice for the pitch demo, not required
   for the core loop to function — the visibility model exists in the data
   whether or not the toggle UI exists).

## 12. Out of scope entirely for this hackathon

- Persistent database, auth, multi-show history, deployment/hosting concerns
  beyond running locally for the demo.
- Custom personality authoring beyond editing a preset's prompt text.

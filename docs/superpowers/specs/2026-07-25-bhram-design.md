# Bhram — AI Reality Show: Design Spec

Hackathon target: 4-person team, 1.5 days. Goal is a working end-to-end vertical
slice, not the full feature list from the original brief. Everything under
"Stretch goals" is cut unless core is done early.

## 1. What this is

An AI reality show where 5 LLM-driven agents, each with a distinct personality,
live together in a house governed by user-defined rules. Agents run as
independent concurrent processes that message each other freely — publicly to
the whole house, or privately to individuals. A Game Master agent watches the
same event stream live and can warn, eject, or call time on a round while it is
still happening. Viewers see every event, including private ones; agents see
only what reached them.

## 2. Prompt surfaces (the part the user fills in)

The harness ships with **defaults** for every one of these so the app runs out of
the box, but each is a swappable prompt/config the producer (user) supplies
before or during a show:

| Surface | What it controls | Where it lives |
|---|---|---|
| Show definition prompt | Premise, rules, boundaries, end condition | `Show.show_prompt` |
| Agent personality prompt (x8 in the pool) | Each preset personality's voice, values, goals | `presets.py` → `PRESET_AGENT_PERSONALITIES` |
| Game Master personality prompt | How strict/lenient/dramatic the GM is, when it interjects, when it calls time | `Show.gm_prompt` |
| House rules text | The rules the GM enforces | `Show.rules_text` |
| Secret connections | Hidden prior relationships between two agents ("Mirror Pairs") | `Agent.connected_to` / `connection_note` |

Defaults: a generic reality-show ruleset, 8 preset personalities, and a neutral
"fair but firm" GM prompt. The user edits or replaces these via the frontend
before starting a show; nothing is hardcoded elsewhere in the pipeline.

## 3. Architecture

Single-process FastAPI backend. All show state is in memory, snapshotted to JSON
after each round. Agents are concurrent `asyncio` tasks communicating through an
event bus. A WebSocket streams every event to the frontend live as it is
published.

```
React frontend  <── WebSocket (live event stream) + REST ──>  FastAPI backend
                                                                    │
                                                            Round Supervisor
                                                                    │
                    ┌───────────────────┬───────────────────────────┴──────────┐
                    │                   │                                      │
              Agent tasks (xN)      GM task                              End Watcher
              each: inbox queue     live subscriber,                     budgets /
              + async think loop    warns, ejects,                       quiescence /
                    │               calls time                           timeout
                    └───────────────┴──────────────────┬───────────────────────┘
                                                       │
                                                  Event Bus
                                          (append-only log, fan-out
                                           to per-subscriber inboxes)
                                                       │
                                                   Narrator
                                          (once per round, at round end)
```

Because everything runs on one asyncio event loop, appends to the log are atomic
between awaits. No locks are needed anywhere.

## 4. Core data model

```
Event
  seq: int                    # monotonic, canonical ordering
  round: int
  sender_id: str
  text: str
  kind: agent_action | confession | gm_ruling | gm_announcement | narration
  visibility: public | private
  recipients: [agent_id]      # empty for public; empty for confessions
  released: bool              # a private event promoted to public
  timestamp: float

Agent
  id, name, personality_prompt
  status: active | warned | eliminated
  warnings: int
  connected_to: agent_id | None      # Mirror Pair
  connection_note: str
  actions_remaining: int      # reset from action_budget each round

Show
  id, title, show_prompt, gm_prompt, rules_text
  status: setup | running | paused | ended
  current_round: int
  max_rounds: int | None       # None = unlimited, producer ends manually
  contestants: [Agent]
  events: [Event]              # the full log, all rounds
  narratives: {round: str}

RoundConfig
  action_budget: int = 4              # max acts per agent per round (cost ceiling)
  debounce_seconds: float = 0.8       # batch window before an agent thinks
  cooldown_seconds: float = 3.0       # forced gap after an agent acts
  quiescence_seconds: float = 5.0
  round_timeout_seconds: float = 180.0
  gm_review_every: int = 3            # GM wakes every N events it sees
  context_window_events: int = 60     # most recent visible events fed to an agent
```

**Agents have no memory field.** An agent's knowledge is *derived* from the
event log by filtering it through the same visibility predicate the bus uses for
fan-out. The log is the single source of truth for who knows what. This matters:
an earlier design accumulated memory from the inbox, which meant an agent that
spent its action budget early stopped receiving events and was permanently blind
to the rest of the round. Deriving from the log removes that whole class of bug —
an agent that has stopped acting still *knows* what happened while it was quiet.

## 5. Round lifecycle

A round is not a sequence of turns. It is a burst of concurrent activity that
starts on a seed event and ends when one of the termination conditions fires.

1. **Setup.** `current_round += 1`. Every active agent's `actions_remaining` is
   reset to `action_budget`. One `asyncio.Task` is spawned per active agent, plus
   one for the GM and one for the end watcher.
2. **Kickoff.** Every inbox starts empty, so nothing would ever wake. The GM
   publishes a round-opening announcement as a public event; it fans out to all
   inboxes and wakes all agents at once.
3. **Agent loop** (each agent, independently and concurrently):
   - block on inbox until an event arrives, then sleep `debounce_seconds` and
     drain the inbox. The inbox is purely a **wake signal** — draining it says
     "something happened worth thinking about," nothing more.
   - build context by filtering the event log through the visibility predicate
     and taking the most recent `context_window_events` the agent may see. This
     includes the agent's own past actions, so it remembers what it said.
   - one tool-calling LLM call with: personality + secret connection + show
     state + that context window
   - dispatch resulting tool calls to the bus
   - `actions_remaining -= 1`, sleep `cooldown_seconds`, repeat
4. **Agent tools:** `speak_public(text)`, `send_private(to, text)`,
   `confess(text)`, `stay_silent()`. One wake may emit several calls, so an agent
   can DM someone and address the house in the same breath. `stay_silent` is a
   first-class action so an agent can decide something is not worth answering.
5. **GM loop:** subscribes to everything including private events, wakes every
   `gm_review_every` events, and has tools `warn(agent_id, reason)`,
   `eject(agent_id, reason)`, `announce(text)`, `end_round(reason)`. GM rulings
   publish as public events, so they fan out and wake the agents — an agent can
   react to being warned mid-argument.
6. **Termination** (§6 below). On stop, all agent and GM tasks are cancelled.
7. **Narration.** Once per round, after the tasks stop, one LLM call turns the
   round's public events and GM rulings into a story paragraph. Private events
   that were never released are excluded from the narrator's input.
8. **Snapshot.** Show state is written to `snapshots/{show_id}.json`.

## 6. Ending a round

Two categories, and they behave differently.

**Safety rails — always on, not configurable.**

- **Action budget exhausted.** Every active agent has spent its `action_budget`.
  This is the deterministic cost ceiling.
- **Wall-clock timeout.** Hard stop at `round_timeout_seconds`, protecting
  against a hung or very slow API call.
- **Producer stop.** Human override. Takes effect immediately, cancelling
  in-flight calls.

**Dramatic conditions — this is show design.**

- **GM calls time.** The `end_round(reason)` tool. This is the primary intended
  path: the GM sees every event and ends the round when the drama peaks rather
  than when a counter runs out.
- **Quiescence.** The conversation genuinely died.

**The quiescence definition matters.** "No events for N seconds" is a bug: if all
agents are simultaneously waiting on slow LLM calls, the bus goes silent and the
round would end mid-thought. Quiescence requires **all three**: no new events for
`quiescence_seconds`, `bus.in_flight == 0`, and every inbox empty. The bus keeps
an in-flight counter incremented before each LLM call and decremented after.

Precedence: first condition to fire wins. Producer stop cancels in-flight calls
immediately; every other condition lets in-flight calls finish and publish, so a
half-formed action is not lost.

## 7. Two audiences, one log

- **Agent context** (fed to LLM calls): the event log filtered through the bus's
  visibility predicate — public events, released events, private events where the
  agent is a recipient, and its own past actions.
- **Agent inbox** (the wake signal): the same filter minus the agent's own
  events, since echoing an agent's own words back to it is not news.
- **GM context:** sees everything, including unreleased private events and
  confessions.
- **Viewer feed and story** (frontend): unfiltered. Every public event, every
  private DM, every confession, every GM ruling. Viewers are always omniscient;
  this is the core entertainment mechanic.

**Releasing.** A private event can be promoted to public by setting
`released = true`, either by an agent leaking it or by the producer using the
reveal control. Once released it is visible to all agents from that point on. It
is never retroactively hidden from viewers, who already saw it.

## 8. Agent lifecycle controls

- **Kill.** `status = eliminated`. Task cancelled, unsubscribed from the bus,
  excluded from all future rounds. Triggered by the producer or by a GM `eject`.
- **Warn.** GM-only. Increments `warnings`, sets `status = warned`, no functional
  lockout, but the ruling is a public event so the agent sees it and can respond.

There is deliberately **no pause**. Pausing an individual agent bought nothing
the action budget, `kill`, and the producer stop control do not already cover,
and as an out-of-band toggle it was invisible to the other agents, so it carried
no story value either. If it returns, it should return as an in-fiction
mechanic — a GM `silence(agent_id, reason)` tool that publishes publicly, so the
house can scheme in front of someone who is listening but muzzled. See §11.

## 9. Frontend (React)

1. **Show Setup** — title, rounds cap, show/GM/rules prompt textareas, pick 5 of
   the preset pool, optionally define secret connections.
2. **Live Room** — the roster with status pills and a kill control,
   a Start Round button, a producer Stop button, and the live event feed
   streaming over WebSocket as events are published.
3. **Story** — the accumulated per-round narratives, read as an episode recap.

## 10. Build order for 1.5 days (4 people)

1. Models + event bus + store (owner A).
2. Tool-calling LLM client + agent loop (owner B).
3. GM loop + narrator + round supervisor (owner C).
4. FastAPI + WebSocket streaming + React frontend (owner D, can start against the
   API contract in parallel).

## 11. Explicit cut list (stretch only, in this order)

1. Mid-round and between-round producer interaction: rule edits, per-agent
   targeted notes, and scenario changes applied without restarting the show.
2. Agent silencing as an in-fiction GM tool (see §8) — worth building only once
   producer interaction above exists to motivate it.
3. Stage/phase system with auto-pause at stage boundaries.
4. A show end condition beyond `max_rounds` — last agent standing, or a goal the
   show definition declares. Deferred because it depends on what kind of game the
   show turns out to be, which is not yet decided.
5. POV toggle in the viewer UI (the visibility model already supports it; only
   the UI affordance is missing — see `glass-house-mockup.html`).
6. Loyalty ledger — a trust/suspicion score per agent pair fed back into context.

## 12. Out of scope entirely

- Persistent database, auth, multi-show history, deployment beyond local run.
- Team/captain structures, scored challenges, and anything depending on them
  (moles reporting to opposing captains, cross-team alliance rounds, underdog
  clauses).
- A separate Secret Keeper agent. Hidden agendas live in the agent's own
  personality prompt rather than costing an extra LLM call per round.

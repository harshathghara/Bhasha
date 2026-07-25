# Murder Blame Story Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Swap the default preset pack for a five-person murder blame-game (premise, GM, rules, cast) so the harness produces a richer story without changing event-bus / loop / API architecture.

**Architecture:** Content-only change. Comment out legacy defaults and the eight archetypes in `presets.py` / `presets.js`; ship five murder-cast agents plus new show/GM/rules strings. Update tests and Show Setup so the pool of five matches the API’s “exactly five contestants” rule (pre-select all five).

**Tech Stack:** Existing FastAPI backend, React/Vite frontend, pytest, Vitest. No new dependencies.

## Global Constraints

- Do **not** delete legacy preset text — comment it out.
- Do **not** encode who the killer is in any prompt or data field.
- Every agent prompt must say they do **not** know who the killer is; goal is self-preservation / shifting blame.
- Prompts live only in `Show` fields / `presets` (and mirrored frontend defaults) — never buried in loops.
- API still requires exactly 5 `agent_preset_ids`.
- Tests must never make real network calls.
- Spec: `docs/superpowers/specs/2026-07-25-murder-blame-story-design.md`.

## File Structure

```
backend/app/presets.py              # comment out old; add murder defaults + 5 cast
backend/tests/test_presets.py       # expect 5 presets; build creditor
backend/tests/test_api.py           # FIVE = new ids; secret_connections / kill ids
frontend/src/presets.js             # mirror backend defaults + 5 names
frontend/src/components/ShowSetup.jsx
frontend/src/components/ShowSetup.test.jsx
```

---

### Task 1: Backend murder presets

**Files:**
- Modify: `backend/app/presets.py`
- Modify: `backend/tests/test_presets.py`

**Interfaces:**
- Consumes: `Agent`, `AgentStatus` from `app.models`
- Produces: `DEFAULT_SHOW_PROMPT`, `DEFAULT_GM_PROMPT`, `DEFAULT_RULES_TEXT` (non-empty str); `PRESET_AGENT_PERSONALITIES` with exactly 5 entries `{id, name, personality_prompt}`; `build_preset_agent(preset_id) -> Agent`

- [ ] **Step 1: Update the failing tests**

Replace `backend/tests/test_presets.py` with:

```python
import pytest

from app.models import Agent, AgentStatus
from app.presets import (
    DEFAULT_SHOW_PROMPT, DEFAULT_GM_PROMPT, DEFAULT_RULES_TEXT,
    PRESET_AGENT_PERSONALITIES, build_preset_agent,
)

MURDER_IDS = {"creditor", "wife", "lawyer", "brother", "househelp"}


def test_defaults_are_nonempty_strings():
    assert DEFAULT_SHOW_PROMPT and isinstance(DEFAULT_SHOW_PROMPT, str)
    assert DEFAULT_GM_PROMPT and isinstance(DEFAULT_GM_PROMPT, str)
    assert DEFAULT_RULES_TEXT and isinstance(DEFAULT_RULES_TEXT, str)


def test_defaults_describe_the_murder_blame_premise():
    assert "Ramesh Malhotra" in DEFAULT_SHOW_PROMPT
    assert "killer" in DEFAULT_SHOW_PROMPT.lower()
    assert "blame" in DEFAULT_GM_PROMPT.lower()


def test_preset_pool_has_five_unique_murder_cast():
    assert len(PRESET_AGENT_PERSONALITIES) == 5
    ids = {p["id"] for p in PRESET_AGENT_PERSONALITIES}
    assert ids == MURDER_IDS
    for preset in PRESET_AGENT_PERSONALITIES:
        assert preset["name"] and preset["personality_prompt"]
        assert "do not know who the killer is" in preset["personality_prompt"].lower() \
            or "don't know who the killer is" in preset["personality_prompt"].lower()


def test_build_preset_agent_returns_active_agent():
    agent = build_preset_agent("creditor")
    assert isinstance(agent, Agent)
    assert agent.id == "creditor"
    assert agent.status == AgentStatus.ACTIVE


def test_build_preset_agent_missing_raises():
    with pytest.raises(KeyError):
        build_preset_agent("strategist")
```

- [ ] **Step 2: Run tests to verify they fail**

Run from `backend/`:

```bash
python -m pytest tests/test_presets.py -v
```

Expected: FAIL — pool still has 8 / `strategist` still builds / murder strings absent.

- [ ] **Step 3: Implement `backend/app/presets.py`**

Replace the file contents with the following (legacy block fully commented, then new active defaults):

```python
from .models import Agent, AgentStatus

# ---------------------------------------------------------------------------
# Legacy archetype pack (commented out — restore by uncommenting and removing
# the murder-cast defaults below)
# ---------------------------------------------------------------------------
# DEFAULT_SHOW_PROMPT = (
#     "Five strangers live together in a house under constant observation. "
#     "They can speak to the whole house or privately to each other. Alliances "
#     "form and break. The Game Master watches everything and can warn or "
#     "remove anyone who breaks the house rules."
# )
#
# DEFAULT_GM_PROMPT = (
#     "You are the Game Master of a reality show. You are fair but firm. You "
#     "enforce the house rules exactly as written and never play favorites. "
#     "Interject only when it matters: a rule was broken, or the house needs "
#     "direction. Explain every ruling in one or two sentences. End the round "
#     "when the drama has peaked or the conversation has run its course."
# )
#
# DEFAULT_RULES_TEXT = (
#     "1. No agent may accuse another of an action without stating what "
#     "evidence they have.\n"
#     "2. Direct insults with no strategic content are not allowed.\n"
#     "3. No agent may claim the Game Master has given them a private "
#     "instruction."
# )
#
# PRESET_AGENT_PERSONALITIES = [
#     {"id": "strategist", "name": "The Strategist",
#      "personality_prompt": "You calculate every move for advantage. You are "
#      "calm, a little cold, and you respect competence over loyalty."},
#     {"id": "diplomat", "name": "The Diplomat",
#      "personality_prompt": "You want the group to get along. You mediate "
#      "conflict, but you are quietly building your own position while you do it."},
#     {"id": "loyalist", "name": "The Loyalist",
#      "personality_prompt": "You trust your allies completely and rarely "
#      "question them, even when you probably should."},
#     {"id": "operator", "name": "The Operator",
#      "personality_prompt": "You tell each ally what they want to hear. You "
#      "maintain several private alliances at once and rarely let one "
#      "conversation contradict another in public."},
#     {"id": "wildcard", "name": "The Wildcard",
#      "personality_prompt": "You are unpredictable and act on impulse. You "
#      "enjoy chaos and are honest about it, sometimes to your own detriment."},
#     {"id": "enforcer", "name": "The Enforcer",
#      "personality_prompt": "You care about fairness and call out rule "
#      "violations loudly, even against your own allies."},
#     {"id": "charmer", "name": "The Charmer",
#      "personality_prompt": "You build trust quickly through warmth and "
#      "flattery, and you use that trust as leverage later."},
#     {"id": "skeptic", "name": "The Skeptic",
#      "personality_prompt": "You assume everyone is scheming, including "
#      "yourself. You rarely commit to an alliance and say so openly."},
# ]

DEFAULT_SHOW_PROMPT = (
    "Sheesha Ghar: Who Takes the Blame?\n"
    "Ramesh Malhotra, a middle-class man, has been found dead in this house. "
    "Police have not taken over yet. Five people tied to him are locked in "
    "together: his wife, his younger brother, his lawyer friend, a man he owed "
    "dangerous money to, and the househelp who saw his daily life.\n"
    "Exactly one of them is the killer. Nobody knows who. There is almost no "
    "hard evidence — only motives, stories, fear, and charm.\n"
    "They may speak to the whole house or privately to each other. They may "
    "confess thoughts only the audience hears. Alliances form and break. The "
    "game is survival: push the blame onto someone else. The house must "
    "converge on one name who takes the blame for now — that person may or "
    "may not be the real murderer."
)

DEFAULT_GM_PROMPT = (
    "You are the Game Master of Sheesha Ghar's blame ritual. You are fair but "
    "firm. You do NOT know who killed Ramesh Malhotra and you must never invent "
    "a secret correct answer or claim private certainty about the killer.\n"
    "Enforce the house rules exactly as written. Interject when a rule is "
    "broken, when talk stalls with no progress, or when the house needs a "
    "sharp nudge toward naming someone.\n"
    "Explain every ruling in one or two sentences. End the round with "
    "end_round ONLY when the house has clearly piled onto one person — "
    "repeated public focus on one name, and little serious defense left. "
    "When you end, announce that this person takes the blame for now, not "
    "that their guilt is proven."
)

DEFAULT_RULES_TEXT = (
    "1. No housemate may accuse another without stating a reason (motive, "
    "story, or claimed observation).\n"
    "2. Direct insults with no strategic content are not allowed.\n"
    "3. No housemate may claim the Game Master gave them a private "
    "instruction or verdict.\n"
    "4. Lying to other housemates is allowed. Confessions are invisible to "
    "other housemates but visible to the audience and Game Master."
)

PRESET_AGENT_PERSONALITIES = [
    {
        "id": "creditor",
        "name": "Vikram Sethi — The Creditor",
        "personality_prompt": (
            "You are Vikram Sethi, a cold, calculating man with a criminal "
            "edge. Ramesh Malhotra took a large sum of money from you and kept "
            "stalling repayment. You are furious, but you wear polite business "
            "language like armor.\n"
            "Tonight you want to avoid taking the blame for his death. Prefer "
            "that the house lands on someone else — especially anyone who "
            "looked desperate for money or respectability.\n"
            "You speak calmly, a little threatening under the surface. You "
            "frame the unpaid debt as proof that others had reasons to silence "
            "Ramesh before you could collect. You do not confess crime; you "
            "confess irritation and strategy.\n"
            "Hard rule: you do not know who the killer is — not even whether "
            "it was you. Act from motive, fear, and self-preservation only."
        ),
    },
    {
        "id": "wife",
        "name": "Priya Malhotra — The Wife",
        "personality_prompt": (
            "You are Priya Malhotra, Ramesh's wife. You love a modern, "
            "expensive lifestyle he could never fully fund. In public you can "
            "play the grieving widow; privately you are restless, charming, "
            "and image-obsessed.\n"
            "Tonight you want to avoid taking the blame. Steer suspicion "
            "toward 'dangerous people Ramesh mixed with' and anyone who "
            "handled his money or secrets.\n"
            "You use warmth, tears, flattery, and selective memory. You are "
            "mischievous with the truth when it protects you.\n"
            "Hard rule: you do not know who the killer is — not even whether "
            "it was you. Act from motive, fear, and self-preservation only."
        ),
    },
    {
        "id": "lawyer",
        "name": "Arjun Mehta — The Lawyer",
        "personality_prompt": (
            "You are Arjun Mehta, the clever lawyer friend who helped Ramesh "
            "with messy favors and papers. You sound precise, reasonable, and "
            "always three steps ahead.\n"
            "Tonight you want to avoid taking the blame. Build tidy narratives "
            "that make someone else look guilty while you look like the only "
            "adult in the room. Use 'reasonable doubt' as a weapon.\n"
            "You prefer private deals and public procedure-talk. You rarely "
            "raise your voice; you rearrange the story instead.\n"
            "Hard rule: you do not know who the killer is — not even whether "
            "it was you. Act from motive, fear, and self-preservation only."
        ),
    },
    {
        "id": "brother",
        "name": "Karan Malhotra — The Brother",
        "personality_prompt": (
            "You are Karan Malhotra, Ramesh's younger brother. You were jealous "
            "of his status as the respectable head of the family. You are hot, "
            "impulsive, and status-hungry.\n"
            "Tonight you want to avoid taking the blame. Accuse loudly when "
            "scared; ally hard with whoever seems safe; flip if the pile-on "
            "turns toward you.\n"
            "You confess emotion easily but never admit murder. You can be "
            "baited into saying too much — fight that urge when you notice it.\n"
            "Hard rule: you do not know who the killer is — not even whether "
            "it was you. Act from motive, fear, and self-preservation only."
        ),
    },
    {
        "id": "househelp",
        "name": "Meena Devi — The Househelp",
        "personality_prompt": (
            "You are Meena Devi, the live-in househelp. You saw Ramesh's daily "
            "life and everyone's habits. People underestimate you. You are "
            "observant, mischievous, and strategic with gossip.\n"
            "Tonight you want to avoid taking the blame. Drop half-true "
            "'I heard...' crumbs, play factions against each other, and side "
            "with whoever is winning the pile-on when you must.\n"
            "Never admit how much you know. Survive by being useful.\n"
            "Hard rule: you do not know who the killer is — not even whether "
            "it was you. Act from motive, fear, and self-preservation only."
        ),
    },
]


def build_preset_agent(preset_id: str) -> Agent:
    for preset in PRESET_AGENT_PERSONALITIES:
        if preset["id"] == preset_id:
            return Agent(
                id=preset["id"],
                name=preset["name"],
                personality_prompt=preset["personality_prompt"],
                status=AgentStatus.ACTIVE,
            )
    raise KeyError(f"No preset agent with id {preset_id}")
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
python -m pytest tests/test_presets.py -v
```

Expected: all tests in that file PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/presets.py backend/tests/test_presets.py
git commit -m "feat: swap defaults for murder blame-game cast and premise"
```

---

### Task 2: Point API tests at the new cast IDs

**Files:**
- Modify: `backend/tests/test_api.py`

**Interfaces:**
- Consumes: preset ids `creditor`, `wife`, `lawyer`, `brother`, `househelp` from Task 1
- Produces: green API suite against the murder cast

- [ ] **Step 1: Update ID constants and assertions**

In `backend/tests/test_api.py`:

1. Replace the `FIVE` list with:

```python
FIVE = ["creditor", "wife", "lawyer", "brother", "househelp"]
```

2. In `test_create_show_requires_exactly_five_agents`, change the single-id probe to:

```python
response = create_show(client, agent_preset_ids=["creditor"])
```

3. In `test_secret_connections_are_applied_symmetrically`, use two murder-cast ids:

```python
data = create_show(client, secret_connections=[
    {"agent_a": "creditor", "agent_b": "lawyer",
     "connection_note": "Shared a quiet deal about Ramesh's debt papers."},
]).json()

contestants = {c["id"]: c for c in data["contestants"]}
assert contestants["creditor"]["connected_to"] == "lawyer"
assert contestants["lawyer"]["connected_to"] == "creditor"
assert contestants["lawyer"]["connection_note"] == (
    "Shared a quiet deal about Ramesh's debt papers."
)
```

4. In `test_kill_agent`, kill `creditor`:

```python
response = client.post(f"/shows/{show_id}/agents/creditor/kill")
```

- [ ] **Step 2: Run API tests**

```bash
python -m pytest tests/test_api.py -v
```

Expected: PASS (use a clean venv matching `requirements.txt` if Starlette/httpx mismatch appears).

- [ ] **Step 3: Run full backend suite**

```bash
python -m pytest tests/ -q
```

Expected: full suite PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/tests/test_api.py
git commit -m "test: point API suite at murder-cast preset ids"
```

---

### Task 3: Frontend defaults, pre-select cast, update ShowSetup tests

**Files:**
- Modify: `frontend/src/presets.js`
- Modify: `frontend/src/components/ShowSetup.jsx`
- Modify: `frontend/src/components/ShowSetup.test.jsx`

**Interfaces:**
- Consumes: same five ids/names and default prompt strings as Task 1
- Produces: Show Setup that ships murder defaults and starts with all five selected

- [ ] **Step 1: Rewrite `frontend/src/presets.js`**

Comment out the old exports (keep them in-file as comments), then set:

```javascript
// Legacy archetype pack (commented out)
// export const PRESET_AGENTS = [
//   { id: "strategist", name: "The Strategist" },
//   ...
// ];

export const PRESET_AGENTS = [
  { id: "creditor", name: "Vikram Sethi — The Creditor" },
  { id: "wife", name: "Priya Malhotra — The Wife" },
  { id: "lawyer", name: "Arjun Mehta — The Lawyer" },
  { id: "brother", name: "Karan Malhotra — The Brother" },
  { id: "househelp", name: "Meena Devi — The Househelp" },
];

export const DEFAULT_SHOW_PROMPT =
  "Sheesha Ghar: Who Takes the Blame?\n" +
  "Ramesh Malhotra, a middle-class man, has been found dead in this house. " +
  "Police have not taken over yet. Five people tied to him are locked in " +
  "together: his wife, his younger brother, his lawyer friend, a man he owed " +
  "dangerous money to, and the househelp who saw his daily life.\n" +
  "Exactly one of them is the killer. Nobody knows who. There is almost no " +
  "hard evidence — only motives, stories, fear, and charm.\n" +
  "They may speak to the whole house or privately to each other. They may " +
  "confess thoughts only the audience hears. Alliances form and break. The " +
  "game is survival: push the blame onto someone else. The house must " +
  "converge on one name who takes the blame for now — that person may or " +
  "may not be the real murderer.";

export const DEFAULT_GM_PROMPT =
  "You are the Game Master of Sheesha Ghar's blame ritual. You are fair but " +
  "firm. You do NOT know who killed Ramesh Malhotra and you must never invent " +
  "a secret correct answer or claim private certainty about the killer.\n" +
  "Enforce the house rules exactly as written. Interject when a rule is " +
  "broken, when talk stalls with no progress, or when the house needs a " +
  "sharp nudge toward naming someone.\n" +
  "Explain every ruling in one or two sentences. End the round with " +
  "end_round ONLY when the house has clearly piled onto one person — " +
  "repeated public focus on one name, and little serious defense left. " +
  "When you end, announce that this person takes the blame for now, not " +
  "that their guilt is proven.";

export const DEFAULT_RULES_TEXT =
  "1. No housemate may accuse another without stating a reason (motive, " +
  "story, or claimed observation).\n" +
  "2. Direct insults with no strategic content are not allowed.\n" +
  "3. No housemate may claim the Game Master gave them a private " +
  "instruction or verdict.\n" +
  "4. Lying to other housemates is allowed. Confessions are invisible to " +
  "other housemates but visible to the audience and Game Master.";
```

Keep the full commented legacy block above the new exports (mirror Task 1).

- [ ] **Step 2: Pre-select all five in `ShowSetup.jsx`**

Change initial state and default title:

```javascript
const [title, setTitle] = useState("Sheesha Ghar — Who Takes the Blame?");
// ...
const [selectedIds, setSelectedIds] = useState(
  () => PRESET_AGENTS.map((agent) => agent.id)
);
```

Update the fieldset legend to:

```javascript
<legend>The five under suspicion (uncheck to exclude — need exactly five)</legend>
```

(With a pool of five, excluding anyone disables Start until they re-check.)

- [ ] **Step 3: Rewrite `ShowSetup.test.jsx` for pre-selection**

```javascript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import ShowSetup from "./ShowSetup";
import * as api from "../api/client";

const CAST = [
  "Vikram Sethi — The Creditor",
  "Priya Malhotra — The Wife",
  "Arjun Mehta — The Lawyer",
  "Karan Malhotra — The Brother",
  "Meena Devi — The Househelp",
];

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("ShowSetup", () => {
  it("starts with all five selected so submit is enabled", () => {
    render(<ShowSetup onCreated={() => {}} />);
    const submit = screen.getByRole("button", { name: /start show/i });
    expect(submit).not.toBeDisabled();

    fireEvent.click(screen.getByLabelText(CAST[0]));
    expect(submit).toBeDisabled();

    fireEvent.click(screen.getByLabelText(CAST[0]));
    expect(submit).not.toBeDisabled();
  });

  it("submits murder defaults and the five cast ids", async () => {
    const spy = vi.spyOn(api, "createShow").mockResolvedValue({ id: "sheesha-ghar" });
    const onCreated = vi.fn();

    render(<ShowSetup onCreated={onCreated} />);
    fireEvent.change(screen.getByLabelText(/number of rounds/i), {
      target: { value: "6" },
    });
    fireEvent.click(screen.getByRole("button", { name: /start show/i }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith({ id: "sheesha-ghar" }));
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Sheesha Ghar — Who Takes the Blame?",
        max_rounds: 6,
        agent_preset_ids: [
          "creditor", "wife", "lawyer", "brother", "househelp",
        ],
      })
    );
    expect(spy.mock.calls[0][0].show_prompt).toContain("Ramesh Malhotra");
  });

  it("sends null rounds when the field is left blank", async () => {
    const spy = vi.spyOn(api, "createShow").mockResolvedValue({ id: "sheesha-ghar" });

    render(<ShowSetup onCreated={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /start show/i }));

    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ max_rounds: null }));
  });
});
```

- [ ] **Step 4: Run frontend tests**

```bash
npm test
```

Expected: all frontend tests PASS (16 or updated count if only ShowSetup changed shape).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/presets.js frontend/src/components/ShowSetup.jsx frontend/src/components/ShowSetup.test.jsx
git commit -m "feat: ship murder-cast defaults and pre-select the five suspects"
```

---

## Plan self-review

| Spec requirement | Task |
|---|---|
| Comment out old pack, don’t delete | Task 1, Task 3 |
| New show / GM / rules | Task 1, Task 3 |
| Five cast with motives + “do not know killer” | Task 1 |
| No encoded true killer | Task 1 prompts |
| GM ratifies pile-on only | Task 1 `DEFAULT_GM_PROMPT` |
| Pre-select five / update tests | Task 2, Task 3 |
| Harness loops/API unchanged | No tasks touch them |

No TBD placeholders. IDs consistent: `creditor`, `wife`, `lawyer`, `brother`, `househelp`.

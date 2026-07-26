# Bhram — Murder Blame Story Design

Branch: `story-optimization`  
Status: approved for planning  
Related harness: `2026-07-25-bhram-design.md`

## 1. Goal

Replace the default reality-show archetype pack with a **murder blame-game** premise so five LLM agents produce a more interesting story: motives, private scheming, public accusations, and a scapegoat who may or may not be the real killer.

This is a **content / defaults** change. It must not break harness standards: prompts live in `Show` / `presets`, exactly five contestants per show, visibility only in `EventBus`, no new persistence or auth.

## 2. Story premise

**Working title:** Bhram — Who Takes the Blame?

Five people connected to the dead man are in the house. He was found dead here. Police have not taken over. **Exactly one of them is the killer.** Nobody knows who — including via character prompts. There is almost no hard evidence. The game is survival: speak publicly, message privately, confess to viewers, and push blame onto someone else.

**End of a decisive round (producer/GM):** The five must **converge on one name** through talk and alliances. The Game Master only ratifies when the house has clearly piled onto one person. That person “takes the blame for now.” They may or may not be the real murderer; the system never encodes a correct answer.

### Truth model

| Fact | Encoded where? |
|---|---|
| One of the five is the killer | Show premise text only (public) |
| Who the killer is | **Nowhere** — not in any agent prompt, GM prompt, or data field |
| Each agent’s job | Avoid taking the blame; manipulate; survive |

## 3. Approach (chosen)

**Swap the default preset pack (Approach 1).**

- Comment out existing default show/GM/rules text and the eight archetype personalities (do not delete).
- Activate exactly **five** new preset agents for the murder cast.
- Mirror IDs/names and default prompts on the frontend.
- Update tests that hardcode eight presets or old IDs (`strategist`, etc.).
- Pre-select all five in Show Setup (pool size equals required contestant count).

Rejected alternatives: multi-pack UI (overkill); rewriting text onto old archetype IDs (confusing; fights “comment out, don’t delete”).

## 4. Prompt surfaces

### 4.1 Show premise (`DEFAULT_SHOW_PROMPT`)

Must state:

- Victim identity: **Ramesh Malhotra**, middle-class man, found dead in the house.
- The five are people tied to him; police not yet in charge.
- Exactly one of them is the killer; no one knows who.
- Little hard evidence; the social game is to settle blame on someone.
- Public and private talk, confessions, alliances, and betrayal are expected.
- The house’s task is to converge on who takes the blame.

### 4.2 Game Master (`DEFAULT_GM_PROMPT`)

- Host of a blame ritual, not a detective with the answer.
- Never claim to know the real killer; never invent a private “correct” verdict.
- Fair but firm on house rules.
- Interject when rules break or talk stalls without progress.
- **Ratify / `end_round` only when the house has clearly piled onto one name** (repeated public focus, weak or abandoned defense).
- When ending, announce that this person takes the blame *for now*, not that guilt is proven.

### 4.3 House rules (`DEFAULT_RULES_TEXT`)

1. Accusations need a stated reason (motive, story, or claimed observation) — not baseless naming.
2. Direct insults with no strategic content are not allowed.
3. No agent may claim the Game Master gave them a private instruction or verdict.
4. Lying to housemates is allowed; confessions remain invisible to other housemates (viewers and GM still see them per harness rules).

## 5. Cast (active preset pool)

Victim is **not** a playable agent. He exists only in premise and motives.

| id | Display name | Role |
|---|---|---|
| `creditor` | Vikram Sethi — The Creditor | Criminal-adjacent; Ramesh took money from him and stalled repayment. Cold, calculating; frames debt as others’ motive. |
| `wife` | Priya Malhotra — The Wife | Wife; fond of modern expensive lifestyle Ramesh couldn’t fund. Charming, image-obsessed; plays grief; steers blame to “dangerous people.” |
| `lawyer` | Arjun Mehta — The Lawyer | Clever friend/advisor on Ramesh’s messy favors. Precise, verbal; builds tidy narratives that exonerate him. |
| `brother` | Karan Malhotra — The Brother | Younger brother; jealous of Ramesh’s family status. Hot, impulsive; loud accusations; flips when scared. |
| `househelp` | Meena Devi — The Househelp | Live-in help; sees all; strategic gossip. Mischievous, underestimated; half-true crumbs; sides with whoever is winning. |

### Personality prompt shape (each agent)

Each `personality_prompt` must include, in order:

1. Identity and relation to Ramesh.
2. What you want tonight (avoid blame; preferably land it on someone else).
3. How you speak and plot (clever / mischievous / impulsive / cold, etc.).
4. Hard constraint: **you do not know who the killer is** (not even whether it was you); act from motive, fear, and self-preservation only.

No prompt may say “you murdered Ramesh” or name another agent as the killer as fact.

## 6. Harness integration (non-goals and touch list)

### Must not change

- Event bus visibility model
- Agent loop / GM loop / supervisor structure
- Tool schemas (`speak_public`, `send_private`, `confess`, `stay_silent`, GM warn/eject/announce/end_round)
- API route contracts (still exactly five `agent_preset_ids`)
- Narrator pipeline (public/released events only; one authentic kindness rule remains acceptable)

### Must change

| Location | Change |
|---|---|
| `backend/app/presets.py` | Comment out old defaults + 8 archetypes; add new defaults + 5 personalities |
| `frontend/src/presets.js` | Same mirroring for UI defaults and agent picker |
| `frontend/src/components/ShowSetup.jsx` | Default title; initial `selectedIds` = all five new ids |
| `backend/tests/test_presets.py` | Expect length 5; sample `build_preset_agent("creditor")` (or equivalent) |
| `backend/tests/test_api.py` | `FIVE` = the five new ids |
| Frontend tests | Update any hardcoded old preset ids/names |

### Out of scope

- Secret true-killer field or random killer assignment
- Dedicated vote tool (consensus stays emergent in dialogue)
- POV toggle, loyalty ledger, stage system (already deferred in harness spec)

## 7. Success criteria

1. Producer can start a show with the five murder-cast agents using shipped defaults.
2. Agents argue, private-message, and confess in character from distinct motives.
3. GM does not invent a known killer; ends a round when blame has clearly concentrated on one person.
4. Existing harness tests pass after ID/count updates; no real network calls in tests.
5. Old archetype pack remains in source as comments for easy restore.

## 8. Implementation note

After this spec is approved, write a task-level plan (`docs/superpowers/plans/`) and implement on `story-optimization` without deleting commented legacy presets.

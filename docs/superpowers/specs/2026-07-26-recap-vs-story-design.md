# Round Recap vs Story Chapters — Design

Status: implementing  
Choice: **per-round story chapters with character display names** (option 2)

## Product

| | Round recap | Story chapter (Story so far) |
|---|---|---|
| Job | Instant producer beat after the round | Episode prose the audience can read |
| Scope | This round only | This round only as one labeled chapter |
| Tone | Tight, analytical show-notes | Character-driven narrative |
| Names | Prefer clear names; focus on what shifted | **Must** use contestant display names |
| Length | 2–4 short sentences | 1 short paragraph (3–6 sentences) |
| Visibility | No unreleased privates / confessions | Same |

UI: modal shows **recap**; **Story so far** lists `Round N` + story chapter for each completed round.

## Generation

Two LLM calls at round end (same visible event filter):

1. Recap prompt → `show.recaps[round]`
2. Story-chapter prompt (with id→display-name map) → `show.narratives[round]`

API: `POST /rounds` → `{ round, recap, narrative }` (`narrative` = story chapter).

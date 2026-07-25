from .models import EventKind, GM_ID, PRODUCER_ID, Visibility

RECAP_SYSTEM = (
    "You write the ROUND RECAP for a reality show producer board. "
    "2 to 4 short sentences. Third person. Focus on what shifted this round: "
    "who got heat, which alliances moved, whether blame concentrated. "
    "Do not invent facts that are not in the round content. "
    "Prefer clear character names when they appear in the log. "
    "Do not write novelistic scene-setting or emotional prose — this is a "
    "tight status update, not a story chapter. "
    "If something kind, brave, or loyal genuinely happened, mention it once "
    "briefly; do not invent one."
)

STORY_SYSTEM = (
    "You write ONE STORY CHAPTER for this round of a reality show — prose "
    "for the viewing audience. Third person. 3 to 6 sentences. "
    "You MUST refer to people by their character display names from the cast "
    "list (e.g. Priya, Vikram), never by bare ids like wife or creditor. "
    "Write vivid, readable narrative: tension, betrayal, accusation — based "
    "only on the round content. Do not invent facts. "
    "This chapter covers ONLY this round; do not summarize earlier rounds. "
    "If something kind, brave, or loyal genuinely happened, weave it in; "
    "do not invent one if none occurred."
)


def _name_map(show) -> dict:
    names = {GM_ID: "the Game Master", PRODUCER_ID: "the producer"}
    for agent in show.contestants:
        # Prefer the short name before an em dash, if present.
        label = agent.name.split("—")[0].split("-")[0].strip()
        names[agent.id] = label or agent.name
    return names


def _visible_lines(events, name_map) -> list:
    lines = []
    for event in events:
        if event.kind == EventKind.CONFESSION:
            continue
        if event.visibility == Visibility.PRIVATE and not event.released:
            continue
        who = name_map.get(event.sender_id, event.sender_id)
        lines.append(f"{who}: {event.text}")
    return lines


def _cast_roster(show) -> str:
    return "\n".join(
        f"- id `{a.id}` → call them \"{ _name_map(show)[a.id] }\" "
        f"(full label: {a.name})"
        for a in show.contestants
    )


def build_recap_prompt(show, events) -> tuple:
    name_map = _name_map(show)
    lines = _visible_lines(events, name_map)
    user_prompt = (
        f"Round {show.current_round} — write the RECAP only.\n"
        f"Round content:\n"
        + ("\n".join(lines) or "(the house was silent)")
    )
    return RECAP_SYSTEM, user_prompt


def build_story_chapter_prompt(show, events) -> tuple:
    name_map = _name_map(show)
    lines = _visible_lines(events, name_map)
    user_prompt = (
        f"Round {show.current_round} — write the STORY CHAPTER for this round.\n"
        f"Cast (use these display names):\n{_cast_roster(show)}\n\n"
        f"Round content:\n"
        + ("\n".join(lines) or "(the house was silent)")
    )
    return STORY_SYSTEM, user_prompt


# Back-compat alias used by older tests/imports.
def build_narrator_prompt(show, events) -> tuple:
    return build_story_chapter_prompt(show, events)


def run_round_narration(show, events, llm_client) -> tuple:
    """Return (recap, story_chapter) for the round."""
    recap_sys, recap_user = build_recap_prompt(show, events)
    story_sys, story_user = build_story_chapter_prompt(show, events)
    recap = llm_client.complete(recap_sys, recap_user).strip()
    story = llm_client.complete(story_sys, story_user).strip()
    return recap, story


def run_narrator(show, events, llm_client) -> str:
    """Back-compat: return story chapter only."""
    _, story = run_round_narration(show, events, llm_client)
    return story

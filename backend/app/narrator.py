from .models import EventKind, Visibility


def build_narrator_prompt(show, events) -> tuple:
    system_prompt = (
        "You are the narrator of a reality show. Write a short third-person "
        "recap paragraph, three to five sentences, of this round for the "
        "viewing audience. Do not invent facts that are not in the round "
        "content. No matter how hostile the round was, find and highlight at "
        "least one authentic act of kindness, courage, or loyalty from what "
        "actually happened. Do not fabricate one if there genuinely was none."
    )

    lines = []
    for event in events:
        if event.kind == EventKind.CONFESSION:
            continue
        if event.visibility == Visibility.PRIVATE and not event.released:
            continue
        lines.append(f"{event.sender_id}: {event.text}")

    user_prompt = (
        f"Round {show.current_round} content:\n"
        + ("\n".join(lines) or "(the house was silent)")
    )
    return system_prompt, user_prompt


def run_narrator(show, events, llm_client) -> str:
    system_prompt, user_prompt = build_narrator_prompt(show, events)
    return llm_client.complete(system_prompt, user_prompt).strip()

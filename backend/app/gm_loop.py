import asyncio

from .models import AgentStatus, EventKind, Visibility, GM_ID
from .tools import GM_TOOLS


def build_gm_prompt(show, batch) -> tuple:
    roster = ", ".join(
        f"{a.name} (id: {a.id}, status: {a.status.value}, warnings: {a.warnings})"
        for a in show.contestants
    )

    system_prompt = (
        f"{show.gm_prompt}\n\n"
        f"Show premise: {show.show_prompt}\n"
        f"House rules you enforce: {show.rules_text}\n"
        f"Housemates: {roster}\n\n"
        "You see everything, including private messages and confessions the "
        "housemates believe are secret. Use the tools only when action is "
        "warranted. Doing nothing is usually correct."
    )

    lines = []
    for event in batch:
        if event.kind == EventKind.PRODUCER_NOTE:
            lines.append(f"[PRODUCER CLUE] {event.text}")
        elif event.kind == EventKind.CONFESSION:
            lines.append(f"[CONFESSION by {event.sender_id}] {event.text}")
        elif event.visibility == Visibility.PRIVATE:
            lines.append(
                f"[PRIVATE {event.sender_id} -> {event.recipients}] {event.text}"
            )
        else:
            lines.append(f"{event.sender_id}: {event.text}")

    user_prompt = (
        "Recent activity in the house:\n" + ("\n".join(lines) or "(nothing yet)")
    )
    return system_prompt, user_prompt


def dispatch_gm_calls(show, bus, calls, stop_event) -> None:
    for call in calls:
        name = call["name"]
        arguments = call.get("arguments", {})
        if name in ("warn", "eject"):
            try:
                agent = show.get_agent(arguments["agent_id"])
            except KeyError:
                continue
            if name == "warn":
                agent.warnings += 1
                agent.status = AgentStatus.WARNED
            else:
                agent.status = AgentStatus.ELIMINATED
            bus.publish(GM_ID, arguments["reason"], kind=EventKind.GM_RULING)
        elif name == "announce":
            bus.publish(GM_ID, arguments["text"], kind=EventKind.GM_ANNOUNCEMENT)
        elif name == "end_round":
            bus.publish(GM_ID, arguments["reason"], kind=EventKind.GM_ANNOUNCEMENT)
            stop_event.set()


def _drain(inbox) -> list:
    drained = []
    while not inbox.empty():
        drained.append(inbox.get_nowait())
    return drained


async def run_gm_loop(show, bus, llm_client, config, stop_event) -> None:
    inbox = bus.subscribe(GM_ID)
    seen_since_review = 0
    try:
        while not stop_event.is_set():
            first = await inbox.get()
            batch = [first] + _drain(inbox)
            seen_since_review += len(batch)
            if seen_since_review < config.gm_review_every:
                continue
            seen_since_review = 0

            system_prompt, user_prompt = build_gm_prompt(show, batch)
            bus.in_flight += 1
            try:
                calls = await asyncio.get_event_loop().run_in_executor(
                    None, llm_client.complete_with_tools,
                    system_prompt, user_prompt, GM_TOOLS,
                )
            finally:
                bus.in_flight -= 1

            dispatch_gm_calls(show, bus, calls, stop_event)
    except asyncio.CancelledError:
        pass
    finally:
        bus.unsubscribe(GM_ID)

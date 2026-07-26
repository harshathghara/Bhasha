import asyncio

from .event_bus import perform_leak
from .models import AgentStatus, EventKind, Visibility
from .tools import AGENT_TOOLS


def build_agent_prompt(show, agent, bus, config) -> tuple:
    connection_line = ""
    if agent.connected_to:
        connection_line = (
            f"\nSomething only you know: {agent.connection_note} "
            "Nobody else in the house knows this connection exists."
        )

    housemates = ", ".join(
        f"{a.name} (id: {a.id})" for a in show.active_agents() if a.id != agent.id
    )

    system_prompt = (
        f"You are {agent.name} in a reality show.\n"
        f"{agent.personality_prompt}\n\n"
        f"Show premise: {show.show_prompt}\n"
        f"House rules: {show.rules_text}\n"
        f"Other housemates: {housemates}"
        f"{connection_line}\n\n"
        "Use the tools to act. You may use several in one turn: speak to the "
        "house, send private messages, and record a confession. If nothing "
        "here deserves a response, use stay_silent.\n\n"
        "Pay close attention to anything marked [PUBLIC LEAK]. A leak reveals "
        "who really said what to whom behind closed doors — it is direct "
        "evidence of a lie, a betrayal, or a hidden alliance. Let it change "
        "who you trust, who you ally with, and who you publicly accuse. If "
        "you yourself are exposed by a leak, you have to reckon with it, not "
        "ignore it. If you witness a private message or confession you think "
        "should come out, you may use leak_message to reveal it yourself."
    )

    visible = bus.visible_events_for(agent.id, config.context_window_events)
    history = "\n".join(_format_event(event, agent) for event in visible)

    user_prompt = (
        f"Everything you have seen and said so far:\n"
        f"{history or '(nothing yet)'}\n\n"
        f"It is round {show.current_round}. Decide how you want to act."
    )
    return system_prompt, user_prompt


def _format_event(event, agent) -> str:
    if event.kind == EventKind.GM_RULING:
        return f"[GAME MASTER RULING] {event.text}"
    if event.kind == EventKind.GM_ANNOUNCEMENT:
        return f"[GAME MASTER] {event.text}"
    if event.kind == EventKind.PRODUCER_NOTE:
        return f"[HOUSE ANNOUNCEMENT / NEW CLUE] {event.text}"
    if event.kind == EventKind.LEAK:
        return f"[PUBLIC LEAK — everyone now knows this] {event.text}"
    if event.kind == EventKind.CONFESSION and event.sender_id == agent.id and not event.released:
        return f"[seq {event.seq}, your own private thought] {event.text}"
    if event.sender_id == agent.id:
        if event.visibility == Visibility.PRIVATE and not event.released:
            return f"[seq {event.seq}, you, privately to {event.recipients}] {event.text}"
        return f"[you] {event.text}"
    if event.visibility == Visibility.PRIVATE and not event.released:
        return f"[seq {event.seq}, PRIVATE from {event.sender_id}] {event.text}"
    return f"{event.sender_id}: {event.text}"


def dispatch_agent_calls(bus, agent, calls) -> int:
    published = 0
    for call in calls:
        name = call["name"]
        arguments = call.get("arguments", {})
        if name == "speak_public":
            bus.publish(agent.id, arguments["text"])
        elif name == "send_private":
            bus.publish(agent.id, arguments["text"],
                        visibility=Visibility.PRIVATE,
                        recipients=[arguments["to"]])
        elif name == "confess":
            bus.publish(agent.id, arguments["text"], kind=EventKind.CONFESSION,
                        visibility=Visibility.PRIVATE, recipients=[])
        elif name == "leak_message":
            target = _find_event(bus.show, arguments.get("event_seq"))
            if target is None or not bus.can_see(target, agent.id):
                continue
            try:
                perform_leak(bus, target, agent.id)
            except (ValueError, KeyError, IndexError):
                continue
        else:
            continue
        published += 1
    return published


def _find_event(show, seq):
    for event in show.events:
        if event.seq == seq:
            return event
    return None


def _drain(inbox) -> list:
    drained = []
    while not inbox.empty():
        drained.append(inbox.get_nowait())
    return drained


async def run_agent_loop(show, agent, bus, llm_client, config) -> None:
    inbox = bus.subscribe(agent.id)
    try:
        while agent.actions_remaining > 0:
            if agent.status == AgentStatus.ELIMINATED:
                return

            # The inbox is only a wake signal. Draining it says "something
            # happened"; the context itself is rebuilt from the log below.
            await inbox.get()
            if config.debounce_seconds:
                await asyncio.sleep(config.debounce_seconds)
            _drain(inbox)

            if agent.status == AgentStatus.ELIMINATED:
                return

            system_prompt, user_prompt = build_agent_prompt(show, agent, bus, config)

            bus.in_flight += 1
            try:
                calls = await asyncio.get_event_loop().run_in_executor(
                    None, llm_client.complete_with_tools,
                    system_prompt, user_prompt, AGENT_TOOLS,
                )
            finally:
                bus.in_flight -= 1

            dispatch_agent_calls(bus, agent, calls)

            agent.actions_remaining -= 1
            if config.cooldown_seconds:
                await asyncio.sleep(config.cooldown_seconds)
    except asyncio.CancelledError:
        pass
    finally:
        bus.unsubscribe(agent.id)

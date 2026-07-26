import asyncio

from .agent_loop import run_agent_loop
from .gm_loop import run_gm_loop
from .models import EventKind, GM_ID, PRODUCER_ID
from .narrator import run_round_narration

WATCH_POLL_SECONDS = 0.25


async def watch_for_end(show, bus, config, stop_event, started_at) -> None:
    loop = asyncio.get_event_loop()
    last_event_count = len(show.events)
    last_change_at = loop.time()

    try:
        while not stop_event.is_set():
            await asyncio.sleep(WATCH_POLL_SECONDS)
            now = loop.time()

            if now - started_at > config.round_timeout_seconds:
                stop_event.set()
                return

            active = show.active_agents()
            if active and all(a.actions_remaining <= 0 for a in active):
                stop_event.set()
                return

            if len(show.events) != last_event_count:
                last_event_count = len(show.events)
                last_change_at = now
                continue

            settled = bus.in_flight == 0 and bus.all_inboxes_empty()
            if settled and now - last_change_at > config.quiescence_seconds:
                stop_event.set()
                return
    except asyncio.CancelledError:
        pass


async def run_round(show, bus, llm_client, config, store=None,
                    stop_event=None, opening_brief=None):
    show.current_round += 1
    active = show.active_agents()
    for agent in active:
        agent.actions_remaining = config.action_budget

    stop_event = stop_event or asyncio.Event()
    loop = asyncio.get_event_loop()

    agent_tasks = [
        asyncio.create_task(run_agent_loop(show, agent, bus, llm_client, config))
        for agent in active
    ]
    gm_task = asyncio.create_task(
        run_gm_loop(show, bus, llm_client, config, stop_event)
    )
    await asyncio.sleep(0)

    bus.publish(
        GM_ID,
        f"Round {show.current_round} begins. The house is open.",
        kind=EventKind.GM_ANNOUNCEMENT,
    )

    brief = (opening_brief or "").strip()
    if brief:
        bus.publish(PRODUCER_ID, brief, kind=EventKind.PRODUCER_NOTE)

    watcher = asyncio.create_task(
        watch_for_end(show, bus, config, stop_event, loop.time())
    )

    await stop_event.wait()

    for task in agent_tasks + [gm_task, watcher]:
        task.cancel()
    await asyncio.gather(*agent_tasks, gm_task, watcher, return_exceptions=True)

    recap, narrative = run_round_narration(
        show, show.events_for_round(show.current_round), llm_client
    )
    show.recaps[show.current_round] = recap
    show.narratives[show.current_round] = narrative

    if store is not None:
        store.snapshot(show.id)

    return recap, narrative

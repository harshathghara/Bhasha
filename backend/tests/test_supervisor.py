import asyncio

import pytest

from app.event_bus import EventBus
from app.models import Agent, AgentStatus, EventKind, RoundConfig, Show
from app.supervisor import run_round, watch_for_end


def make_show():
    agents = [
        Agent(id="vikram", name="Vikram", personality_prompt="p"),
        Agent(id="meera", name="Meera", personality_prompt="p"),
    ]
    return Show(id="s1", title="T", show_prompt="p", gm_prompt="g",
                rules_text="r", contestants=agents)


def fast_config(**overrides):
    defaults = dict(
        action_budget=1, debounce_seconds=0.0, cooldown_seconds=0.0,
        quiescence_seconds=0.1, round_timeout_seconds=5.0, gm_review_every=100,
    )
    defaults.update(overrides)
    return RoundConfig(**defaults)


class SilentClient:
    """Agents stay silent; narrator returns a fixed recap."""

    def complete_with_tools(self, system_prompt, user_prompt, tools):
        return []

    def complete(self, system_prompt, user_prompt):
        return "A quiet round in the house."


class TalkativeClient:
    def complete_with_tools(self, system_prompt, user_prompt, tools):
        return [{"name": "speak_public", "arguments": {"text": "I am here."}}]

    def complete(self, system_prompt, user_prompt):
        return "Everyone spoke up."


@pytest.mark.asyncio
async def test_run_round_publishes_kickoff_and_runs_agents():
    show = make_show()
    bus = EventBus(show)

    recap, narrative = await asyncio.wait_for(
        run_round(show, bus, TalkativeClient(), fast_config()), timeout=10
    )

    assert show.current_round == 1
    assert show.events[0].kind == EventKind.GM_ANNOUNCEMENT
    spoken = [e.text for e in show.events if e.sender_id in ("vikram", "meera")]
    assert spoken == ["I am here.", "I am here."]
    assert recap == "Everyone spoke up."
    assert narrative == "Everyone spoke up."
    assert show.recaps[1] == "Everyone spoke up."
    assert show.narratives[1] == "Everyone spoke up."


@pytest.mark.asyncio
async def test_run_round_publishes_opening_brief_after_kickoff():
    show = make_show()
    bus = EventBus(show)
    brief = "A bloody handkerchief under the sofa."

    await asyncio.wait_for(
        run_round(
            show, bus, SilentClient(), fast_config(),
            opening_brief=brief,
        ),
        timeout=10,
    )

    assert show.events[0].kind == EventKind.GM_ANNOUNCEMENT
    assert show.events[1].kind == EventKind.PRODUCER_NOTE
    assert show.events[1].sender_id == "producer"
    assert show.events[1].text == brief
    assert show.events[1].round == 1



@pytest.mark.asyncio
async def test_run_round_ends_on_quiescence_when_agents_stay_silent():
    show = make_show()
    bus = EventBus(show)

    recap, narrative = await asyncio.wait_for(
        run_round(show, bus, SilentClient(), fast_config(action_budget=5)),
        timeout=10,
    )

    assert recap == "A quiet round in the house."
    assert narrative == "A quiet round in the house."


@pytest.mark.asyncio
async def test_run_round_resets_action_budget_for_active_agents_only():
    show = make_show()
    show.get_agent("meera").status = AgentStatus.ELIMINATED
    bus = EventBus(show)

    await asyncio.wait_for(
        run_round(show, bus, SilentClient(), fast_config(action_budget=3)),
        timeout=10,
    )

    assert show.get_agent("meera").actions_remaining == 0
    assert show.get_agent("meera").status == AgentStatus.ELIMINATED


@pytest.mark.asyncio
async def test_run_round_snapshots_when_store_given(tmp_path):
    from app.store import ShowStore

    show = make_show()
    bus = EventBus(show)
    store = ShowStore(snapshot_dir=str(tmp_path))
    store.add(show)

    await asyncio.wait_for(
        run_round(show, bus, SilentClient(), fast_config(), store=store), timeout=10
    )

    assert (tmp_path / "s1.json").exists()


@pytest.mark.asyncio
async def test_external_stop_event_ends_the_round():
    show = make_show()
    bus = EventBus(show)
    stop_event = asyncio.Event()

    async def stop_soon():
        await asyncio.sleep(0.05)
        stop_event.set()

    asyncio.create_task(stop_soon())
    await asyncio.wait_for(
        run_round(show, bus, SilentClient(),
                  fast_config(quiescence_seconds=30.0, round_timeout_seconds=30.0),
                  stop_event=stop_event),
        timeout=10,
    )

    assert show.current_round == 1


@pytest.mark.asyncio
async def test_watch_for_end_does_not_fire_quiescence_while_calls_in_flight():
    show = make_show()
    for agent in show.contestants:
        agent.actions_remaining = 5   # keep the budget rail from firing first
    bus = EventBus(show)
    stop_event = asyncio.Event()
    bus.in_flight = 1

    watcher = asyncio.create_task(
        watch_for_end(show, bus, fast_config(quiescence_seconds=0.05),
                      stop_event, asyncio.get_event_loop().time())
    )
    await asyncio.sleep(0.3)
    still_running = not stop_event.is_set()

    bus.in_flight = 0
    await asyncio.sleep(0.3)
    fired_after_settling = stop_event.is_set()

    watcher.cancel()
    await asyncio.gather(watcher, return_exceptions=True)

    assert still_running is True
    assert fired_after_settling is True

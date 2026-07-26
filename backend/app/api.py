import asyncio
import re
from typing import Optional

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .event_bus import EventBus, perform_leak
from .models import (
    AgentStatus, EventKind, GM_ID, RoundConfig, Show, ShowStatus, PRODUCER_ID,
)
from .presets import (
    DEFAULT_GM_PROMPT, DEFAULT_RULES_TEXT, DEFAULT_SHOW_PROMPT, build_preset_agent,
)
from .supervisor import run_round


def slugify_show_id(title: str) -> str:
    """URL-safe id: letters/digits only, no '?' or punctuation that breaks routes."""
    slug = re.sub(r"[^a-z0-9]+", "-", title.lower())
    return slug.strip("-") or "show"


class CreateShowRequest(BaseModel):
    title: str
    show_prompt: str = DEFAULT_SHOW_PROMPT
    gm_prompt: str = DEFAULT_GM_PROMPT
    rules_text: str = DEFAULT_RULES_TEXT
    max_rounds: Optional[int] = None
    secret_connections: list = []
    agent_preset_ids: list


class InjectEventRequest(BaseModel):
    text: str


class StartRoundRequest(BaseModel):
    opening_brief: Optional[str] = None



def create_app(store, llm_client, config: RoundConfig = None) -> FastAPI:
    app = FastAPI()
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    config = config or RoundConfig()
    buses = {}
    sockets = {}
    stop_events = {}

    def bus_for(show):
        if show.id not in buses:
            bus = EventBus(show)
            bus.add_listener(lambda event: _fan_out(show.id, event))
            buses[show.id] = bus
        return buses[show.id]

    def require_show(show_id: str):
        try:
            return store.get(show_id)
        except KeyError:
            raise HTTPException(
                404,
                f"No show with id {show_id}. Create a new show "
                "(server restarts clear in-memory shows).",
            )

    def _fan_out(show_id, event):
        payload = event.to_dict()
        for websocket in list(sockets.get(show_id, [])):
            asyncio.create_task(_safe_send(show_id, websocket, payload))

    async def _safe_send(show_id, websocket, payload):
        try:
            await websocket.send_json(payload)
        except Exception:
            if websocket in sockets.get(show_id, []):
                sockets[show_id].remove(websocket)

    @app.post("/shows")
    def create_show(req: CreateShowRequest):
        if len(req.agent_preset_ids) != 5:
            raise HTTPException(400, "Must pick exactly 5 agents")
        try:
            contestants = [build_preset_agent(pid) for pid in req.agent_preset_ids]
        except KeyError as exc:
            raise HTTPException(400, str(exc)) from exc
        show = Show(
            id=slugify_show_id(req.title),
            title=req.title,
            show_prompt=req.show_prompt,
            gm_prompt=req.gm_prompt,
            rules_text=req.rules_text,
            max_rounds=req.max_rounds,
            contestants=contestants,
            status=ShowStatus.RUNNING,
        )
        try:
            for connection in req.secret_connections:
                agent_a = show.get_agent(connection["agent_a"])
                agent_b = show.get_agent(connection["agent_b"])
                agent_a.connected_to, agent_b.connected_to = agent_b.id, agent_a.id
                agent_a.connection_note = connection["connection_note"]
                agent_b.connection_note = connection["connection_note"]
        except KeyError as exc:
            raise HTTPException(400, str(exc)) from exc
        store.add(show)
        return show.to_dict()

    @app.get("/shows/{show_id}")
    def get_show(show_id: str):
        return require_show(show_id).to_dict()

    @app.post("/shows/{show_id}/rounds")
    async def start_round(show_id: str, req: StartRoundRequest = StartRoundRequest()):
        show = require_show(show_id)
        if show.max_rounds is not None and show.current_round >= show.max_rounds:
            show.status = ShowStatus.ENDED
            raise HTTPException(409, "Show has reached its round limit")

        stop_event = asyncio.Event()
        stop_events[show_id] = stop_event
        try:
            recap, narrative = await run_round(
                show, bus_for(show), llm_client, config, store, stop_event,
                opening_brief=req.opening_brief,
            )
        finally:
            stop_events.pop(show_id, None)

        if show.max_rounds is not None and show.current_round >= show.max_rounds:
            show.status = ShowStatus.ENDED
        return {
            "round": show.current_round,
            "recap": recap,
            "narrative": narrative,
        }

    @app.post("/shows/{show_id}/stop")
    def stop_round(show_id: str):
        stop_event = stop_events.get(show_id)
        if stop_event is None:
            return {"stopped": False}
        stop_event.set()
        return {"stopped": True}

    @app.post("/shows/{show_id}/end")
    def end_show(show_id: str):
        show = require_show(show_id)
        show.status = ShowStatus.ENDED
        stop_event = stop_events.get(show_id)
        if stop_event is not None:
            stop_event.set()
        return show.to_dict()

    @app.post("/shows/{show_id}/agents/{agent_id}/kill")
    def kill_agent(show_id: str, agent_id: str):
        try:
            agent = require_show(show_id).get_agent(agent_id)
        except KeyError:
            raise HTTPException(404, f"No agent with id {agent_id}")
        agent.status = AgentStatus.ELIMINATED
        return agent.to_dict()

    @app.post("/shows/{show_id}/events")
    async def inject_event(show_id: str, req: InjectEventRequest):
        """Publish a public producer clue into the live event log."""
        text = (req.text or "").strip()
        if not text:
            raise HTTPException(400, "text is required")
        show = require_show(show_id)
        event = bus_for(show).publish(
            PRODUCER_ID,
            text,
            kind=EventKind.PRODUCER_NOTE,
        )
        return event.to_dict()

    @app.post("/shows/{show_id}/events/{seq}/release")
    def release_event(show_id: str, seq: int):
        show = require_show(show_id)
        for event in show.events:
            if event.seq == seq:
                event.released = True
                return event.to_dict()
        raise HTTPException(404, "No event with that seq")

    @app.post("/shows/{show_id}/events/{seq}/leak")
    async def leak_event(show_id: str, seq: int):
        show = require_show(show_id)
        bus = bus_for(show)
        for event in show.events:
            if event.seq == seq:
                try:
                    updated, _ = perform_leak(bus, event, GM_ID)
                except ValueError as exc:
                    raise HTTPException(409, str(exc)) from exc
                return updated.to_dict()
        raise HTTPException(404, "No event with that seq")

    @app.websocket("/ws/{show_id}")
    async def show_socket(websocket: WebSocket, show_id: str):
        await websocket.accept()
        sockets.setdefault(show_id, []).append(websocket)
        try:
            while True:
                await websocket.receive_text()
        except WebSocketDisconnect:
            if websocket in sockets.get(show_id, []):
                sockets[show_id].remove(websocket)

    return app

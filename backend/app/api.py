import asyncio
from typing import Optional

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .event_bus import EventBus
from .models import AgentStatus, RoundConfig, Show, ShowStatus
from .presets import (
    DEFAULT_GM_PROMPT, DEFAULT_RULES_TEXT, DEFAULT_SHOW_PROMPT, build_preset_agent,
)
from .supervisor import run_round


class CreateShowRequest(BaseModel):
    title: str
    show_prompt: str = DEFAULT_SHOW_PROMPT
    gm_prompt: str = DEFAULT_GM_PROMPT
    rules_text: str = DEFAULT_RULES_TEXT
    max_rounds: Optional[int] = None
    secret_connections: list = []
    agent_preset_ids: list


class StartRoundRequest(BaseModel):
    producer_note: Optional[str] = None


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
        show = Show(
            id=req.title.lower().replace(" ", "-"),
            title=req.title,
            show_prompt=req.show_prompt,
            gm_prompt=req.gm_prompt,
            rules_text=req.rules_text,
            max_rounds=req.max_rounds,
            contestants=[build_preset_agent(pid) for pid in req.agent_preset_ids],
            status=ShowStatus.RUNNING,
        )
        for connection in req.secret_connections:
            agent_a = show.get_agent(connection["agent_a"])
            agent_b = show.get_agent(connection["agent_b"])
            agent_a.connected_to, agent_b.connected_to = agent_b.id, agent_a.id
            agent_a.connection_note = connection["connection_note"]
            agent_b.connection_note = connection["connection_note"]
        store.add(show)
        return show.to_dict()

    @app.get("/shows/{show_id}")
    def get_show(show_id: str):
        return store.get(show_id).to_dict()

    @app.post("/shows/{show_id}/rounds")
    async def start_round(show_id: str, req: StartRoundRequest = None):
        req = req or StartRoundRequest()
        show = store.get(show_id)
        if show.max_rounds is not None and show.current_round >= show.max_rounds:
            show.status = ShowStatus.ENDED
            raise HTTPException(409, "Show has reached its round limit")

        stop_event = asyncio.Event()
        stop_events[show_id] = stop_event
        try:
            narrative = await run_round(
                show, bus_for(show), llm_client, config, store, stop_event,
                producer_note=req.producer_note,
            )
        finally:
            stop_events.pop(show_id, None)

        if show.max_rounds is not None and show.current_round >= show.max_rounds:
            show.status = ShowStatus.ENDED
        return {"round": show.current_round, "narrative": narrative}

    @app.post("/shows/{show_id}/stop")
    def stop_round(show_id: str):
        stop_event = stop_events.get(show_id)
        if stop_event is None:
            return {"stopped": False}
        stop_event.set()
        return {"stopped": True}

    @app.post("/shows/{show_id}/agents/{agent_id}/kill")
    def kill_agent(show_id: str, agent_id: str):
        agent = store.get(show_id).get_agent(agent_id)
        agent.status = AgentStatus.ELIMINATED
        return agent.to_dict()

    @app.post("/shows/{show_id}/events/{seq}/release")
    def release_event(show_id: str, seq: int):
        show = store.get(show_id)
        for event in show.events:
            if event.seq == seq:
                event.released = True
                return event.to_dict()
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

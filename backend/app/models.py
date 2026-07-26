from dataclasses import dataclass, field
from enum import Enum
from typing import Optional

GM_ID = "game_master"
PRODUCER_ID = "producer"


class AgentStatus(str, Enum):
    ACTIVE = "active"
    WARNED = "warned"
    ELIMINATED = "eliminated"


class ShowStatus(str, Enum):
    SETUP = "setup"
    RUNNING = "running"
    PAUSED = "paused"
    ENDED = "ended"


class EventKind(str, Enum):
    AGENT_ACTION = "agent_action"
    CONFESSION = "confession"
    GM_RULING = "gm_ruling"
    GM_ANNOUNCEMENT = "gm_announcement"
    PRODUCER_NOTE = "producer_note"
    NARRATION = "narration"
    LEAK = "leak"


class Visibility(str, Enum):
    PUBLIC = "public"
    PRIVATE = "private"


@dataclass
class Event:
    seq: int
    round: int
    sender_id: str
    text: str
    kind: EventKind = EventKind.AGENT_ACTION
    visibility: Visibility = Visibility.PUBLIC
    recipients: list = field(default_factory=list)
    released: bool = False
    timestamp: float = 0.0
    leaked_from_seq: Optional[int] = None

    def to_dict(self) -> dict:
        return {
            "seq": self.seq,
            "round": self.round,
            "sender_id": self.sender_id,
            "text": self.text,
            "kind": self.kind.value,
            "visibility": self.visibility.value,
            "recipients": list(self.recipients),
            "released": self.released,
            "timestamp": self.timestamp,
            "leaked_from_seq": self.leaked_from_seq,
        }


@dataclass
class Agent:
    id: str
    name: str
    personality_prompt: str
    status: AgentStatus = AgentStatus.ACTIVE
    warnings: int = 0
    connected_to: str = None
    connection_note: str = ""
    actions_remaining: int = 0

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "personality_prompt": self.personality_prompt,
            "status": self.status.value,
            "warnings": self.warnings,
            "connected_to": self.connected_to,
            "connection_note": self.connection_note,
            "actions_remaining": self.actions_remaining,
        }


@dataclass
class Show:
    id: str
    title: str
    show_prompt: str
    gm_prompt: str
    rules_text: str
    contestants: list = field(default_factory=list)
    status: ShowStatus = ShowStatus.SETUP
    current_round: int = 0
    max_rounds: int = None
    events: list = field(default_factory=list)
    narratives: dict = field(default_factory=dict)  # story chapters by round
    recaps: dict = field(default_factory=dict)  # producer recaps by round

    def get_agent(self, agent_id: str) -> Agent:
        for agent in self.contestants:
            if agent.id == agent_id:
                return agent
        raise KeyError(f"No agent with id {agent_id}")

    def active_agents(self) -> list:
        return [
            a for a in self.contestants
            if a.status in (AgentStatus.ACTIVE, AgentStatus.WARNED)
        ]

    def events_for_round(self, round_number: int) -> list:
        return [e for e in self.events if e.round == round_number]

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "title": self.title,
            "show_prompt": self.show_prompt,
            "gm_prompt": self.gm_prompt,
            "rules_text": self.rules_text,
            "contestants": [a.to_dict() for a in self.contestants],
            "status": self.status.value,
            "current_round": self.current_round,
            "max_rounds": self.max_rounds,
            "events": [e.to_dict() for e in self.events],
            "narratives": dict(self.narratives),
            "recaps": dict(self.recaps),
        }


@dataclass
class RoundConfig:
    action_budget: int = 4
    debounce_seconds: float = 0.8
    cooldown_seconds: float = 3.0
    quiescence_seconds: float = 5.0
    round_timeout_seconds: float = 180.0
    gm_review_every: int = 3
    context_window_events: int = 60

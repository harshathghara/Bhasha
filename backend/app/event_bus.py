import asyncio
import time

from .models import Event, EventKind, Visibility, GM_ID


class EventBus:
    def __init__(self, show):
        self.show = show
        self.inboxes = {}
        self.listeners = []
        self.in_flight = 0

    def subscribe(self, subscriber_id: str) -> asyncio.Queue:
        queue = asyncio.Queue()
        self.inboxes[subscriber_id] = queue
        return queue

    def unsubscribe(self, subscriber_id: str) -> None:
        self.inboxes.pop(subscriber_id, None)

    def add_listener(self, listener) -> None:
        self.listeners.append(listener)

    def all_inboxes_empty(self) -> bool:
        return all(queue.empty() for queue in self.inboxes.values())

    def can_see(self, event: Event, subscriber_id: str) -> bool:
        """Whether this subscriber is entitled to know about this event at all."""
        if subscriber_id == GM_ID:
            return True
        if subscriber_id == event.sender_id:
            return True
        if event.visibility == Visibility.PUBLIC or event.released:
            return True
        return subscriber_id in event.recipients

    def visible_events_for(self, subscriber_id: str, limit: int = None) -> list:
        events = [e for e in self.show.events if self.can_see(e, subscriber_id)]
        if limit is not None:
            return events[-limit:]
        return events

    def publish(self, sender_id: str, text: str,
                kind: EventKind = EventKind.AGENT_ACTION,
                visibility: Visibility = Visibility.PUBLIC,
                recipients: list = None) -> Event:
        event = Event(
            seq=len(self.show.events),
            round=self.show.current_round,
            sender_id=sender_id,
            text=text,
            kind=kind,
            visibility=visibility,
            recipients=list(recipients or []),
            timestamp=time.time(),
        )
        self.show.events.append(event)

        for subscriber_id, queue in self.inboxes.items():
            if self._is_visible_to(event, subscriber_id):
                queue.put_nowait(event)

        for listener in self.listeners:
            listener(event)

        return event

    def _is_visible_to(self, event: Event, subscriber_id: str) -> bool:
        """Inbox fan-out: entitlement, minus self-echo. An agent is never woken
        by its own words, but visible_events_for still remembers them."""
        if subscriber_id == event.sender_id:
            return False
        return self.can_see(event, subscriber_id)

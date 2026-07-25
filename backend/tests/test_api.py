from fastapi.testclient import TestClient

from app.api import create_app
from app.models import Event, EventKind, RoundConfig, Visibility
from app.store import ShowStore

FIVE = ["creditor", "wife", "lawyer", "brother", "househelp"]


class TalkativeClient:
    def complete_with_tools(self, system_prompt, user_prompt, tools):
        return [{"name": "speak_public", "arguments": {"text": "I am here."}}]

    def complete(self, system_prompt, user_prompt):
        return "A lively round."


def fast_config():
    return RoundConfig(
        action_budget=1, debounce_seconds=0.0, cooldown_seconds=0.0,
        quiescence_seconds=0.1, round_timeout_seconds=5.0, gm_review_every=100,
    )


def make_client(tmp_path):
    store = ShowStore(snapshot_dir=str(tmp_path))
    app = create_app(store, TalkativeClient(), fast_config())
    return TestClient(app), store


def create_show(client, **overrides):
    body = {"title": "Sheesha Ghar", "agent_preset_ids": FIVE}
    body.update(overrides)
    return client.post("/shows", json=body)


def test_create_show_requires_exactly_five_agents(tmp_path):
    client, _ = make_client(tmp_path)
    response = create_show(client, agent_preset_ids=["creditor"])
    assert response.status_code == 400


def test_create_show_returns_running_show_with_five_contestants(tmp_path):
    client, _ = make_client(tmp_path)
    data = create_show(client).json()
    assert len(data["contestants"]) == 5
    assert data["status"] == "running"


def test_secret_connections_are_applied_symmetrically(tmp_path):
    client, _ = make_client(tmp_path)
    data = create_show(client, secret_connections=[
        {"agent_a": "creditor", "agent_b": "lawyer",
         "connection_note": "Former business partners."},
    ]).json()

    contestants = {c["id"]: c for c in data["contestants"]}
    assert contestants["creditor"]["connected_to"] == "lawyer"
    assert contestants["lawyer"]["connected_to"] == "creditor"
    assert contestants["lawyer"]["connection_note"] == "Former business partners."


def test_run_round_returns_narrative(tmp_path):
    client, _ = make_client(tmp_path)
    show_id = create_show(client).json()["id"]

    response = client.post(f"/shows/{show_id}/rounds")

    assert response.status_code == 200
    assert response.json() == {"round": 1, "narrative": "A lively round."}


def test_round_limit_is_enforced(tmp_path):
    client, _ = make_client(tmp_path)
    show_id = create_show(client, max_rounds=1).json()["id"]

    assert client.post(f"/shows/{show_id}/rounds").status_code == 200
    assert client.post(f"/shows/{show_id}/rounds").status_code == 409
    assert client.get(f"/shows/{show_id}").json()["status"] == "ended"


def test_end_show_marks_status_ended(tmp_path):
    client, _ = make_client(tmp_path)
    show_id = create_show(client).json()["id"]

    response = client.post(f"/shows/{show_id}/end")

    assert response.status_code == 200
    assert response.json()["status"] == "ended"
    assert client.get(f"/shows/{show_id}").json()["status"] == "ended"


def test_kill_agent(tmp_path):
    client, _ = make_client(tmp_path)
    show_id = create_show(client).json()["id"]

    response = client.post(f"/shows/{show_id}/agents/creditor/kill")

    assert response.json()["status"] == "eliminated"


def test_release_event_marks_it_released(tmp_path):
    client, store = make_client(tmp_path)
    show_id = create_show(client).json()["id"]
    client.post(f"/shows/{show_id}/rounds")

    response = client.post(f"/shows/{show_id}/events/0/release")

    assert response.status_code == 200
    assert response.json()["released"] is True
    assert store.get(show_id).events[0].released is True


def test_release_missing_event_returns_404(tmp_path):
    client, _ = make_client(tmp_path)
    show_id = create_show(client).json()["id"]
    assert client.post(f"/shows/{show_id}/events/999/release").status_code == 404


def test_leak_event_reveals_a_private_message(tmp_path):
    client, store = make_client(tmp_path)
    show_id = create_show(client).json()["id"]
    show = store.get(show_id)
    show.events.append(Event(
        seq=0, round=1, sender_id="creditor", text="Ally with me.",
        visibility=Visibility.PRIVATE, recipients=["wife"],
    ))

    response = client.post(f"/shows/{show_id}/events/0/leak")

    assert response.status_code == 200
    assert response.json()["released"] is True
    leak_events = [e for e in show.events if e.kind == EventKind.LEAK]
    assert len(leak_events) == 1
    assert leak_events[0].sender_id == "game_master"
    assert "leaked" in leak_events[0].text.lower()


def test_leak_missing_event_returns_404(tmp_path):
    client, _ = make_client(tmp_path)
    show_id = create_show(client).json()["id"]
    assert client.post(f"/shows/{show_id}/events/999/leak").status_code == 404


def test_leak_public_event_returns_409(tmp_path):
    client, store = make_client(tmp_path)
    show_id = create_show(client).json()["id"]
    show = store.get(show_id)
    show.events.append(Event(seq=0, round=1, sender_id="creditor", text="Hello house."))

    assert client.post(f"/shows/{show_id}/events/0/leak").status_code == 409


def test_leak_already_leaked_event_returns_409(tmp_path):
    client, store = make_client(tmp_path)
    show_id = create_show(client).json()["id"]
    show = store.get(show_id)
    show.events.append(Event(
        seq=0, round=1, sender_id="creditor", text="Ally with me.",
        visibility=Visibility.PRIVATE, recipients=["wife"],
    ))
    client.post(f"/shows/{show_id}/events/0/leak")

    assert client.post(f"/shows/{show_id}/events/0/leak").status_code == 409


def test_websocket_streams_events_during_a_round(tmp_path):
    client, _ = make_client(tmp_path)
    show_id = create_show(client).json()["id"]

    with client.websocket_connect(f"/ws/{show_id}") as websocket:
        client.post(f"/shows/{show_id}/rounds")
        first = websocket.receive_json()

    assert first["kind"] == "gm_announcement"
    assert first["seq"] == 0

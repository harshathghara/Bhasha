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


def test_show_id_strips_punctuation_that_breaks_urls(tmp_path):
    client, _ = make_client(tmp_path)
    data = create_show(
        client, title="Sheesha Ghar — Who Takes the Blame?"
    ).json()
    assert data["id"] == "sheesha-ghar-who-takes-the-blame"
    assert "?" not in data["id"]


def test_secret_connections_are_applied_symmetrically(tmp_path):
    client, _ = make_client(tmp_path)
    data = create_show(client, secret_connections=[
        {"agent_a": "creditor", "agent_b": "lawyer",
         "connection_note": "Shared a quiet deal about Ramesh's debt papers."},
    ]).json()

    contestants = {c["id"]: c for c in data["contestants"]}
    assert contestants["creditor"]["connected_to"] == "lawyer"
    assert contestants["lawyer"]["connected_to"] == "creditor"
    assert contestants["lawyer"]["connection_note"] == (
        "Shared a quiet deal about Ramesh's debt papers."
    )


def test_run_round_returns_recap_and_narrative(tmp_path):
    client, store = make_client(tmp_path)
    show_id = create_show(client).json()["id"]

    response = client.post(f"/shows/{show_id}/rounds")

    assert response.status_code == 200
    assert response.json() == {
        "round": 1,
        "recap": "A lively round.",
        "narrative": "A lively round.",
    }
    show = store.get(show_id)
    assert show.recaps[1] == "A lively round."
    assert show.narratives[1] == "A lively round."


def test_start_round_with_opening_brief_publishes_after_kickoff(tmp_path):
    client, store = make_client(tmp_path)
    show_id = create_show(client).json()["id"]
    brief = "Police found a second set of footprints by the back door."

    response = client.post(
        f"/shows/{show_id}/rounds",
        json={"opening_brief": brief},
    )

    assert response.status_code == 200
    events = store.get(show_id).events
    assert events[0].kind.value == "gm_announcement"
    assert events[0].round == 1
    assert events[1].kind.value == "producer_note"
    assert events[1].sender_id == "producer"
    assert events[1].text == brief
    assert events[1].round == 1


def test_two_rounds_accumulate_narratives_and_brief_on_round_two(tmp_path):
    client, store = make_client(tmp_path)
    show_id = create_show(client, max_rounds=3).json()["id"]

    assert client.post(f"/shows/{show_id}/rounds").status_code == 200
    brief = "Someone wiped blood from the stair railing overnight."
    assert client.post(
        f"/shows/{show_id}/rounds",
        json={"opening_brief": brief},
    ).status_code == 200

    show = store.get(show_id)
    assert show.current_round == 2
    assert set(show.narratives) == {1, 2}
    assert set(show.recaps) == {1, 2}
    assert show.narratives[1] == "A lively round."
    assert show.narratives[2] == "A lively round."
    assert show.recaps[2] == "A lively round."

    round_two = show.events_for_round(2)
    assert round_two[0].kind.value == "gm_announcement"
    assert "Round 2 begins" in round_two[0].text
    assert round_two[1].kind.value == "producer_note"
    assert round_two[1].text == brief


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


def test_create_show_with_invalid_preset_id_returns_400(tmp_path):
    client, _ = make_client(tmp_path)
    response = create_show(
        client,
        agent_preset_ids=["creditor", "wife", "lawyer", "brother", "not-a-real-preset"]
    )
    assert response.status_code == 400


def test_create_show_with_unknown_agent_in_secret_connection_returns_400(tmp_path):
    client, _ = make_client(tmp_path)
    response = create_show(
        client,
        secret_connections=[
            {"agent_a": "unknown-agent", "agent_b": "lawyer",
             "connection_note": "Test connection."},
        ]
    )
    assert response.status_code == 400


def test_inject_event_publishes_public_producer_note(tmp_path):
    client, store = make_client(tmp_path)
    show_id = create_show(client).json()["id"]

    response = client.post(
        f"/shows/{show_id}/events",
        json={"text": "A bloody handkerchief was found under the sofa."},
    )

    assert response.status_code == 200
    data = response.json()
    assert data["kind"] == "producer_note"
    assert data["sender_id"] == "producer"
    assert data["visibility"] == "public"
    assert "handkerchief" in data["text"]
    assert store.get(show_id).events[-1].text == data["text"]


def test_inject_event_rejects_empty_text(tmp_path):
    client, _ = make_client(tmp_path)
    show_id = create_show(client).json()["id"]
    assert client.post(
        f"/shows/{show_id}/events", json={"text": "   "}
    ).status_code == 400

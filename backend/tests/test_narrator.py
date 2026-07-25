from app.models import Event, EventKind, Show, Visibility
from app.narrator import build_narrator_prompt, run_narrator


class FakeLLMClient:
    def __init__(self, text):
        self.text = text

    def complete(self, system_prompt, user_prompt):
        return self.text


def make_show():
    return Show(id="s1", title="T", show_prompt="p", gm_prompt="g",
                rules_text="r", current_round=1)


def test_narrator_prompt_excludes_unreleased_private_and_confessions():
    show = make_show()
    events = [
        Event(seq=0, round=1, sender_id="vikram", text="I trust no one."),
        Event(seq=1, round=1, sender_id="meera", text="Secret alliance plan.",
              visibility=Visibility.PRIVATE, recipients=["vikram"]),
        Event(seq=2, round=1, sender_id="meera", text="I am terrified.",
              kind=EventKind.CONFESSION, visibility=Visibility.PRIVATE),
        Event(seq=3, round=1, sender_id="game_master", text="Vikram warned.",
              kind=EventKind.GM_RULING),
    ]

    _, user_prompt = build_narrator_prompt(show, events)

    assert "I trust no one." in user_prompt
    assert "Vikram warned." in user_prompt
    assert "Secret alliance plan." not in user_prompt
    assert "I am terrified." not in user_prompt


def test_narrator_prompt_includes_released_private_event():
    show = make_show()
    events = [
        Event(seq=0, round=1, sender_id="meera", text="Leaked plan.",
              visibility=Visibility.PRIVATE, recipients=["vikram"], released=True),
    ]
    _, user_prompt = build_narrator_prompt(show, events)
    assert "Leaked plan." in user_prompt


def test_narrator_prompt_carries_the_one_good_deed_rule():
    show = make_show()
    system_prompt, _ = build_narrator_prompt(show, [])
    assert "act of kindness" in system_prompt.lower()


def test_run_narrator_strips_whitespace():
    show = make_show()
    assert run_narrator(show, [], FakeLLMClient("  A tense round.  \n")) == "A tense round."

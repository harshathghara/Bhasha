from app.models import Agent, Event, EventKind, Show, Visibility
from app.narrator import (
    build_narrator_prompt,
    build_recap_prompt,
    build_story_chapter_prompt,
    run_narrator,
    run_round_narration,
)


class FakeLLMClient:
    def __init__(self, text="A tense round.", responses=None):
        self.text = text
        self.responses = list(responses or [])
        self.calls = []

    def complete(self, system_prompt, user_prompt):
        self.calls.append((system_prompt, user_prompt))
        if self.responses:
            return self.responses.pop(0)
        return self.text


def make_show():
    agents = [
        Agent(id="creditor", name="Vikram Sethi — The Creditor",
              personality_prompt="p"),
        Agent(id="wife", name="Priya Malhotra — The Wife",
              personality_prompt="p"),
    ]
    return Show(
        id="s1", title="T", show_prompt="p", gm_prompt="g",
        rules_text="r", current_round=1, contestants=agents,
    )


def test_visible_filter_excludes_unreleased_private_and_confessions():
    show = make_show()
    events = [
        Event(seq=0, round=1, sender_id="creditor", text="I trust no one."),
        Event(seq=1, round=1, sender_id="wife", text="Secret alliance plan.",
              visibility=Visibility.PRIVATE, recipients=["creditor"]),
        Event(seq=2, round=1, sender_id="wife", text="I am terrified.",
              kind=EventKind.CONFESSION, visibility=Visibility.PRIVATE),
        Event(seq=3, round=1, sender_id="game_master", text="Vikram warned.",
              kind=EventKind.GM_RULING),
    ]

    _, user_prompt = build_story_chapter_prompt(show, events)

    assert "I trust no one." in user_prompt
    assert "Vikram warned." in user_prompt
    assert "Secret alliance plan." not in user_prompt
    assert "I am terrified." not in user_prompt
    assert "Vikram Sethi" in user_prompt or "Vikram" in user_prompt


def test_story_prompt_includes_released_private_event():
    show = make_show()
    events = [
        Event(seq=0, round=1, sender_id="wife", text="Leaked plan.",
              visibility=Visibility.PRIVATE, recipients=["creditor"],
              released=True),
    ]
    _, user_prompt = build_story_chapter_prompt(show, events)
    assert "Leaked plan." in user_prompt


def test_recap_and_story_prompts_differ():
    show = make_show()
    recap_sys, _ = build_recap_prompt(show, [])
    story_sys, story_user = build_story_chapter_prompt(show, [])
    assert "ROUND RECAP" in recap_sys or "producer" in recap_sys.lower()
    assert "STORY CHAPTER" in story_sys or "display names" in story_sys.lower()
    assert "not a story chapter" in recap_sys.lower()
    assert "Priya" in story_user or "cast" in story_user.lower()
    assert "kindness" not in recap_sys.lower() or "briefly" in recap_sys.lower()


def test_narrator_prompt_alias_is_story_chapter():
    show = make_show()
    system_prompt, _ = build_narrator_prompt(show, [])
    assert "display names" in system_prompt.lower() \
        or "story chapter" in system_prompt.lower()


def test_run_round_narration_returns_recap_and_story():
    show = make_show()
    client = FakeLLMClient(responses=["  Recap text.  ", "  Story chapter.  "])
    recap, story = run_round_narration(show, [], client)
    assert recap == "Recap text."
    assert story == "Story chapter."
    assert len(client.calls) == 2
    assert "RECAP" in client.calls[0][0].upper() \
        or "producer" in client.calls[0][0].lower()
    assert "STORY" in client.calls[1][0].upper() \
        or "display" in client.calls[1][0].lower()


def test_run_narrator_returns_story_chapter_only():
    show = make_show()
    assert run_narrator(
        show, [], FakeLLMClient(responses=["r", "  A tense round.  \n"])
    ) == "A tense round."

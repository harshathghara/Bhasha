from app.tools import AGENT_TOOLS, GM_TOOLS, tool_names


def test_agent_tools_expose_the_five_actions():
    assert tool_names(AGENT_TOOLS) == {
        "speak_public", "send_private", "confess", "stay_silent", "leak_message",
    }


def test_leak_message_requires_event_seq():
    schema = next(t for t in AGENT_TOOLS if t["function"]["name"] == "leak_message")
    required = schema["function"]["parameters"]["required"]
    assert set(required) == {"event_seq"}


def test_gm_tools_expose_the_four_powers():
    assert tool_names(GM_TOOLS) == {"warn", "eject", "announce", "end_round"}


def test_send_private_requires_to_and_text():
    schema = next(t for t in AGENT_TOOLS if t["function"]["name"] == "send_private")
    required = schema["function"]["parameters"]["required"]
    assert set(required) == {"to", "text"}


def test_every_tool_is_a_well_formed_openai_function_schema():
    for tool in AGENT_TOOLS + GM_TOOLS:
        assert tool["type"] == "function"
        assert tool["function"]["name"]
        assert tool["function"]["description"]
        assert tool["function"]["parameters"]["type"] == "object"

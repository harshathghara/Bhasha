def _function(name: str, description: str, properties: dict, required: list) -> dict:
    return {
        "type": "function",
        "function": {
            "name": name,
            "description": description,
            "parameters": {
                "type": "object",
                "properties": properties,
                "required": required,
            },
        },
    }


AGENT_TOOLS = [
    _function(
        "speak_public",
        "Say something out loud to the whole house. Everyone hears it.",
        {"text": {"type": "string", "description": "What you say out loud."}},
        ["text"],
    ),
    _function(
        "send_private",
        "Send a private message to one other housemate. Nobody else hears it.",
        {
            "to": {"type": "string", "description": "The agent id of the recipient."},
            "text": {"type": "string", "description": "What you say privately."},
        },
        ["to", "text"],
    ),
    _function(
        "confess",
        "Record a private thought in the confession booth. No housemate ever "
        "hears this, but the viewing audience does.",
        {"text": {"type": "string", "description": "Your private thought."}},
        ["text"],
    ),
    _function(
        "leak_message",
        "Reveal a private message or confession you know about to the "
        "whole house. Use this if it fits your personality and goals — "
        "it will be publicly announced and everyone will react to it.",
        {
            "event_seq": {
                "type": "integer",
                "description": "The seq number of the private message or "
                "confession to leak, from your own knowledge so far.",
            },
        },
        ["event_seq"],
    ),
    _function(
        "stay_silent",
        "Decide that nothing here is worth responding to right now.",
        {},
        [],
    ),
]

GM_TOOLS = [
    _function(
        "warn",
        "Publicly warn a housemate for breaking a house rule.",
        {
            "agent_id": {"type": "string", "description": "Who is being warned."},
            "reason": {"type": "string", "description": "Why, in one or two sentences."},
        },
        ["agent_id", "reason"],
    ),
    _function(
        "eject",
        "Remove a housemate from the show immediately for a serious or "
        "repeated rule violation.",
        {
            "agent_id": {"type": "string", "description": "Who is being removed."},
            "reason": {"type": "string", "description": "Why, in one or two sentences."},
        },
        ["agent_id", "reason"],
    ),
    _function(
        "announce",
        "Make a public announcement to the whole house.",
        {"text": {"type": "string", "description": "The announcement."}},
        ["text"],
    ),
    _function(
        "end_round",
        "Call time on this round. Use when the drama has peaked or the "
        "conversation has run its course.",
        {"reason": {"type": "string", "description": "Why you are ending the round."}},
        ["reason"],
    ),
]


def tool_names(tools: list) -> set:
    return {tool["function"]["name"] for tool in tools}

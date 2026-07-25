import json
from unittest.mock import MagicMock, patch

from app.llm_client import LLMClient, OpenAILLMClient


def make_tool_call(name, arguments_json):
    call = MagicMock()
    call.function.name = name
    call.function.arguments = arguments_json
    return call


def test_client_passes_base_url_to_openai_sdk():
    with patch("app.llm_client.OpenAI") as mock_openai:
        LLMClient(
            model="openai/gpt-oss-120b",
            api_key="gsk",
            base_url="https://api.groq.com/openai/v1",
        )
        mock_openai.assert_called_once_with(
            api_key="gsk",
            base_url="https://api.groq.com/openai/v1",
        )


def test_openai_alias_still_works():
    assert OpenAILLMClient is LLMClient


def test_complete_returns_message_content():
    response = MagicMock()
    response.choices = [MagicMock(message=MagicMock(content="a recap"))]

    with patch("app.llm_client.OpenAI") as mock_openai:
        mock_openai.return_value.chat.completions.create.return_value = response
        client = LLMClient(api_key="test-key")
        assert client.complete("system", "user") == "a recap"


def test_complete_with_tools_parses_calls():
    message = MagicMock()
    message.tool_calls = [
        make_tool_call("speak_public", json.dumps({"text": "hello"})),
        make_tool_call("send_private", json.dumps({"to": "meera", "text": "psst"})),
    ]
    response = MagicMock()
    response.choices = [MagicMock(message=message)]

    with patch("app.llm_client.OpenAI") as mock_openai:
        mock_openai.return_value.chat.completions.create.return_value = response
        client = LLMClient(api_key="test-key")
        calls = client.complete_with_tools("system", "user", [{"type": "function"}])

    assert calls == [
        {"name": "speak_public", "arguments": {"text": "hello"}},
        {"name": "send_private", "arguments": {"to": "meera", "text": "psst"}},
    ]


def test_complete_with_tools_returns_empty_when_no_tool_calls():
    message = MagicMock()
    message.tool_calls = None
    response = MagicMock()
    response.choices = [MagicMock(message=message)]

    with patch("app.llm_client.OpenAI") as mock_openai:
        mock_openai.return_value.chat.completions.create.return_value = response
        client = LLMClient(api_key="test-key")
        assert client.complete_with_tools("system", "user", []) == []


def test_complete_with_tools_skips_malformed_arguments():
    message = MagicMock()
    message.tool_calls = [
        make_tool_call("speak_public", "{not valid json"),
        make_tool_call("confess", json.dumps({"text": "ok"})),
    ]
    response = MagicMock()
    response.choices = [MagicMock(message=message)]

    with patch("app.llm_client.OpenAI") as mock_openai:
        mock_openai.return_value.chat.completions.create.return_value = response
        client = LLMClient(api_key="test-key")
        calls = client.complete_with_tools("system", "user", [])

    assert calls == [{"name": "confess", "arguments": {"text": "ok"}}]

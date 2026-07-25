import pytest

from app.llm_config import resolve_llm_settings


def test_openai_defaults():
    env = {
        "LLM_PROVIDER": "openai",
        "LLM_MODEL": "gpt-4o-mini",
        "OPENAI_API_KEY": "sk-test",
    }
    settings = resolve_llm_settings(getenv=env.get)
    assert settings == {
        "provider": "openai",
        "model": "gpt-4o-mini",
        "api_key": "sk-test",
        "base_url": None,
    }


def test_groq_uses_groq_base_url_and_key():
    env = {
        "LLM_PROVIDER": "groq",
        "LLM_MODEL": "openai/gpt-oss-120b",
        "GROQ_API_KEY": "gsk-test",
    }
    settings = resolve_llm_settings(getenv=env.get)
    assert settings["provider"] == "groq"
    assert settings["model"] == "openai/gpt-oss-120b"
    assert settings["api_key"] == "gsk-test"
    assert settings["base_url"] == "https://api.groq.com/openai/v1"


def test_falls_back_to_openai_model_env():
    env = {"OPENAI_API_KEY": "sk-test", "OPENAI_MODEL": "gpt-4o"}
    settings = resolve_llm_settings(getenv=env.get)
    assert settings["provider"] == "openai"
    assert settings["model"] == "gpt-4o"


def test_unknown_provider_raises():
    with pytest.raises(ValueError, match="Unknown LLM_PROVIDER"):
        resolve_llm_settings(getenv={"LLM_PROVIDER": "anthropic"}.get)


def test_missing_groq_key_raises():
    with pytest.raises(ValueError, match="GROQ_API_KEY"):
        resolve_llm_settings(getenv={"LLM_PROVIDER": "groq", "LLM_MODEL": "x"}.get)


def test_missing_openai_key_raises():
    with pytest.raises(ValueError, match="OPENAI_API_KEY"):
        resolve_llm_settings(getenv={"LLM_PROVIDER": "openai"}.get)

import os

GROQ_BASE_URL = "https://api.groq.com/openai/v1"


def resolve_llm_settings(getenv=os.getenv) -> dict:
    provider = (getenv("LLM_PROVIDER") or "openai").strip().lower()
    model = getenv("LLM_MODEL") or getenv("OPENAI_MODEL") or "gpt-4o-mini"

    if provider == "openai":
        api_key = getenv("OPENAI_API_KEY")
        if not api_key:
            raise ValueError("OPENAI_API_KEY is required when LLM_PROVIDER=openai")
        return {
            "provider": "openai",
            "model": model,
            "api_key": api_key,
            "base_url": None,
        }

    if provider == "groq":
        api_key = getenv("GROQ_API_KEY")
        if not api_key:
            raise ValueError("GROQ_API_KEY is required when LLM_PROVIDER=groq")
        return {
            "provider": "groq",
            "model": model,
            "api_key": api_key,
            "base_url": GROQ_BASE_URL,
        }

    raise ValueError(
        f"Unknown LLM_PROVIDER {provider!r}. Expected: openai, groq"
    )

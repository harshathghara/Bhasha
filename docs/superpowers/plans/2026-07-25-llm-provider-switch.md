# LLM Provider Switch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Switch between OpenAI and Groq via `.env` (`LLM_PROVIDER`, `LLM_MODEL`, provider-specific API keys) using one OpenAI-compatible client.

**Architecture:** Resolve provider → `(api_key, base_url, model)` at startup. `LLMClient` wraps the OpenAI SDK; Groq uses `base_url=https://api.groq.com/openai/v1`. Existing `complete` / `complete_with_tools` API unchanged.

**Tech Stack:** Python 3.11+, `openai` SDK, `python-dotenv`, pytest.

## Global Constraints

- No new dependency (use existing `openai` package for Groq).
- Fail fast at startup for unknown provider or missing active key.
- Keep `OPENAI_MODEL` as fallback for `LLM_MODEL`.
- Tests must never make real network calls.
- Do not commit unless the user explicitly asks.

---

## File Structure

| File | Responsibility |
|---|---|
| `backend/app/llm_client.py` | `LLMClient` (+ `OpenAILLMClient` alias), optional `base_url` |
| `backend/app/llm_config.py` | `resolve_llm_settings()` from env |
| `backend/app/main.py` | Wire resolved settings into client |
| `backend/.env.example` | Document env vars |
| `backend/tests/test_llm_client.py` | Client construction + existing behavior |
| `backend/tests/test_llm_config.py` | Provider resolution tests |

---

### Task 1: Provider config resolver

**Files:**
- Create: `backend/app/llm_config.py`
- Create: `backend/tests/test_llm_config.py`

**Interfaces:**
- Produces: `resolve_llm_settings(getenv=os.getenv) -> dict` with keys `provider`, `model`, `api_key`, `base_url` (`base_url` is `None` for openai)

- [x] **Step 1: Write failing tests**

```python
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && python -m pytest tests/test_llm_config.py -v`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement `llm_config.py`**

```python
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && python -m pytest tests/test_llm_config.py -v`
Expected: PASS

---

### Task 2: LLMClient accepts base_url

**Files:**
- Modify: `backend/app/llm_client.py`
- Modify: `backend/tests/test_llm_client.py`

**Interfaces:**
- Consumes: constructor args `model`, `api_key`, `base_url=None`
- Produces: `LLMClient` with `OpenAILLMClient = LLMClient` alias

- [ ] **Step 1: Write failing test for base_url wiring**

```python
def test_client_passes_base_url_to_openai_sdk():
    with patch("app.llm_client.OpenAI") as mock_openai:
        LLMClient(model="openai/gpt-oss-120b", api_key="gsk", base_url="https://api.groq.com/openai/v1")
        mock_openai.assert_called_once_with(
            api_key="gsk",
            base_url="https://api.groq.com/openai/v1",
        )
```

Update imports to use `LLMClient`; keep existing tests working via alias or rename.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_llm_client.py::test_client_passes_base_url_to_openai_sdk -v`
Expected: FAIL (unexpected kwarg or name)

- [ ] **Step 3: Implement client**

```python
class LLMClient:
    def __init__(self, model: str = "gpt-4o-mini", api_key: str = None, base_url: str = None):
        self.model = model
        kwargs = {"api_key": api_key or os.environ["OPENAI_API_KEY"]}
        if base_url:
            kwargs["base_url"] = base_url
        self.client = OpenAI(**kwargs)
    # complete / complete_with_tools unchanged

OpenAILLMClient = LLMClient
```

- [ ] **Step 4: Run full llm_client tests**

Run: `cd backend && python -m pytest tests/test_llm_client.py -v`
Expected: PASS

---

### Task 3: Wire main.py + .env.example

**Files:**
- Modify: `backend/app/main.py`
- Modify: `backend/.env.example`
- Modify: `backend/.env` (local only; do not commit secrets)

**Interfaces:**
- Consumes: `resolve_llm_settings()`, `LLMClient`

- [ ] **Step 1: Update main.py**

```python
import os
from dotenv import load_dotenv
from .api import create_app
from .llm_client import LLMClient
from .llm_config import resolve_llm_settings
from .store import ShowStore

load_dotenv()

store = ShowStore(snapshot_dir="snapshots")
settings = resolve_llm_settings()
llm_client = LLMClient(
    model=settings["model"],
    api_key=settings["api_key"],
    base_url=settings["base_url"],
)
app = create_app(store, llm_client)
```

- [ ] **Step 2: Update `.env.example`**

```
LLM_PROVIDER=openai
LLM_MODEL=gpt-4o-mini
OPENAI_API_KEY=
GROQ_API_KEY=
```

- [ ] **Step 3: Update local `.env` shape** (preserve existing OpenAI key; add empty Groq placeholders / provider fields). Do not commit `.env`.

Example for Groq later:
```
LLM_PROVIDER=groq
LLM_MODEL=openai/gpt-oss-120b
OPENAI_API_KEY=<existing>
GROQ_API_KEY=<your groq key>
```

- [ ] **Step 4: Run full backend test suite**

Run: `cd backend && python -m pytest -v`
Expected: PASS

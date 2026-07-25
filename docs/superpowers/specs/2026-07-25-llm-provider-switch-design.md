# LLM Provider Switch (OpenAI / Groq) — Design Spec

Goal: switch between OpenAI and Groq from `.env` without code changes.
Approach: one OpenAI-compatible client; Groq via `base_url`.

## 1. Problem

The backend hardcodes OpenAI (`OpenAILLMClient` + `OPENAI_API_KEY` /
`OPENAI_MODEL`). Using Groq (e.g. `openai/gpt-oss-120b`) currently requires
manual code edits. We want env-only provider selection while keeping both API
keys in `.env`.

## 2. Env configuration

```
LLM_PROVIDER=openai          # openai | groq
LLM_MODEL=gpt-4o-mini        # e.g. openai/gpt-oss-120b for Groq
OPENAI_API_KEY=...
GROQ_API_KEY=...
```

| Variable | Required when | Purpose |
|---|---|---|
| `LLM_PROVIDER` | always (default `openai`) | Selects provider |
| `LLM_MODEL` | always (see fallbacks) | Model id for the active provider |
| `OPENAI_API_KEY` | `LLM_PROVIDER=openai` | OpenAI auth |
| `GROQ_API_KEY` | `LLM_PROVIDER=groq` | Groq auth |

### Backward compatibility

If `LLM_MODEL` is unset, fall back to `OPENAI_MODEL` then `gpt-4o-mini`.
Existing OpenAI-only `.env` files keep working when `LLM_PROVIDER` is unset
(defaults to `openai`).

## 3. Architecture

Keep a single client class that wraps the OpenAI Python SDK.

Provider resolution (at startup in `main.py` or a small factory helper):

| `LLM_PROVIDER` | API key env | `base_url` |
|---|---|---|
| `openai` | `OPENAI_API_KEY` | SDK default (`None`) |
| `groq` | `GROQ_API_KEY` | `https://api.groq.com/openai/v1` |

- Unknown provider → raise a clear error at startup
- Missing key for the active provider → raise a clear error at startup
- Inactive provider's key may be absent; ignore it

Public API of the client stays the same:

- `complete(system_prompt, user_prompt) -> str`
- `complete_with_tools(system_prompt, user_prompt, tools) -> list`

Call sites (`agent_loop`, `gm_loop`, `narrator`, tests using fakes) do not change.

Rename the class to `LLMClient` and update imports/tests accordingly.
Keep `OpenAILLMClient = LLMClient` as a temporary alias so any external
imports do not break.

## 4. Files to change

| File | Change |
|---|---|
| `backend/app/llm_client.py` | Accept `api_key`, `model`, optional `base_url`; construct `OpenAI(...)` accordingly |
| `backend/app/main.py` | Resolve provider → key + base_url + model; construct client |
| `backend/.env.example` | Document new vars |
| `backend/tests/test_llm_client.py` | Cover base_url/key selection (or add a small factory test) |

No new dependency. `openai` package already speaks Groq's OpenAI-compatible API.

## 5. Error handling

Fail fast at process start with messages like:

- `Unknown LLM_PROVIDER 'x'. Expected: openai, groq`
- `GROQ_API_KEY is required when LLM_PROVIDER=groq`
- `OPENAI_API_KEY is required when LLM_PROVIDER=openai`

Do not log secret values.

## 6. Out of scope

- xAI Grok or other non–OpenAI-compatible providers
- Runtime provider switching without restart
- Frontend model picker
- Streaming / different tool schemas per provider

## 7. Verification

- Unit tests: client passes `base_url` and key correctly for groq vs openai
- Manual: set `LLM_PROVIDER=groq`, `LLM_MODEL=openai/gpt-oss-120b`,
  `GROQ_API_KEY=...`, restart backend, confirm a show round can call the LLM
- Manual: switch back to openai with existing key and confirm unchanged behavior

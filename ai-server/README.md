# MindSpear AI server

A FastAPI service that writes quiz questions, quest slides and fun-game questions from the text of a
document. It is the only thing the service does: the frontend sends the selected pages and the
generation options, gets back validated items, and saves them through the Laravel API as before.

Stack: FastAPI, Pydantic (request / item schemas, structured output), LangGraph (the
prompt → model → validate → retry / top-up workflow), LangChain OpenRouter (the model call; default
`anthropic/claude-sonnet-4.5`, any OpenRouter model by `OPENROUTER_MODEL`). LangChain OpenAI is kept as
the other provider (`LLM_PROVIDER=openai`).

## Run it

```bash
cd ai-server
cp .env.example .env            # set OPENROUTER_API_KEY and LARAVEL_API_URL
uv sync                         # or: pip install -e . (and -e .[dev] is "uv sync --group dev")
uv run uvicorn app.main:app --reload --port 8001
```

With docker compose from the repository root the service is `ai-server` on port 8001. The
frontend reaches it through `NEXT_PUBLIC_AI_API_URL` (see `frontend/.env.example`).

Tests: `uv run pytest`. Lint: `uv run ruff check .`

## API

| Method | Path           | Auth | Purpose |
|--------|----------------|------|---------|
| GET    | `/health`      | no   | Liveness. |
| GET    | `/v1/targets`  | no   | The targets, their question types (key, label, hint, default) and the size limits. |
| POST   | `/v1/generate` | yes  | Writes items. Body and response below. |

Auth is the user's Laravel Sanctum token as `Authorization: Bearer …`; it is verified against
`LARAVEL_API_URL/profile/show` and cached for `AUTH_CACHE_SECONDS`. Calls are rate-limited per
token (`RATE_LIMIT_PER_MINUTE`). `AUTH_DISABLED=true` skips both (development only).

Request (same keys the frontend wizard already builds):

```json
{
  "target": "quiz | quest | fungame",
  "textData": "text of the selected pages",
  "topic": "Photosynthesis",
  "questionCount": 10,
  "questionTypes": ["pick_answer_single", "true_false"],
  "difficulty": "Medium",
  "audienceLevel": "College",
  "focusArea": ""
}
```

Response: `{ "target": "...", "questions": [...], "meta": { "requested", "generated", "llm_calls", "rejected", "model" } }`.
Items have the per-target shapes the frontend `mappers.ts` expects. Errors are `{ "error": "message" }`
with 401 / 422 / 429 / 502 as appropriate.

## How a generation runs

```
build_prompt → call_llm → validate ─┬─ nothing usable, attempts left → call_llm   (same prompt again)
                                    ├─ fewer than asked, top-ups left → topup → call_llm
                                    └─ done → END
```

* `validate` keeps every item that passes the target's Pydantic model, is of a requested type and
  is not a repeat. One bad item never discards the rest.
* A top-up asks only for the missing number and lists the titles already written.
* `GENERATION_MAX_ATTEMPTS` and `GENERATION_MAX_TOPUPS` bound the number of model calls.

## Tracing (Langfuse)

Set `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY` and `LANGFUSE_BASE_URL` (both keys = on; the startup log says
`Langfuse tracing: on`). Each `/v1/generate` request is one trace named `generate {target}`, tagged with the
target and question types and carrying the Laravel user id, with the graph nodes (`build_prompt`, `call_llm`,
`validate`) and every model call (prompt, answer, tokens, latency) underneath. `app/tracing.py` builds the
Langfuse callback that rides on the graph's run config. Langfuse gets its own tracer provider, so FastAPI's
built-in request spans (health checks included) are not sent. Traces contain the selected document text.

## Layout

```
app/
  main.py                   app factory, CORS, error → {"error"} handlers
  config.py                 Settings (env)
  errors.py                 AppError family (status codes)
  api/                      routes + dependencies (current user, service)
  security/                 Laravel token verifier, rate limiter
  llm/                      StructuredLLM protocol, LangChain base, OpenRouter / OpenAI providers, factory
  generation/
    types.py                QuestionType / TargetSpec: how a target is described
    registry.py             the targets, by key
    prompting.py            one PromptBuilder for every target
    validation.py           answer → validated items (envelope model, per-item checks)
    service.py              the use case the route calls
    schemas/                request / response models, shared item helpers
    graph/                  LangGraph state + workflow
    targets/                one module per target: types, rules, shapes, item models
```

## Changing the question structure

Everything about a target lives in its module under `app/generation/targets/`:

* **Add a question type to a target**: append a `QuestionType(key, label, rule, shape?, hint?, default?)`
  to its `QUESTION_TYPES`. If the type has its own JSON shape (like the quiz types), add a model
  to the item `Union` with a `type: Literal["…"]` field; if it shares the target's shape, add the key
  to the `Literal` of the type field. The prompt, the schema sent to the model and the validation
  follow from that. Then offer it in the frontend's `features/ai-generate/questionTypes.ts` and map
  it in `mappers.ts`.
* **Change a shape**: edit the model (validation) and the `shape` string (what the prompt shows).
  Keep the two in step; `tests/test_validation.py` is the place to pin the behaviour.
* **Add a target**: a new module that builds a `TargetSpec` and calls `registry.register(...)`,
  imported in `targets/__init__.py`. The frontend's `questionTypes.ts` has the UI labels;
  `/v1/targets` serves the same list so the two can be compared. If items of a type can share a
  title, add the field that tells them apart to `text_fields` (repeats are dropped by it).
* **Another model**: any model OpenRouter lists is only `OPENROUTER_MODEL`.
* **Another model provider**: for a LangChain chat model, subclass `LangChainStructuredLLM`
  (`app/llm/structured.py`; `openrouter.py` is the example), which only builds the chat model; otherwise
  implement `StructuredLLM` (`app/llm/base.py`). Add it to `app/llm/factory.py` and `LLM_PROVIDER`.
  Send the model the envelope's JSON schema but return the answer unvalidated (`LLMOutput`):
  validating the whole answer against the Pydantic models would throw away every good item
  whenever one is wrong. `tests/test_llm.py` pins this for each provider.

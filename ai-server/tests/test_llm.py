"""The providers through their real LangChain and SDK code, against a mocked HTTP endpoint."""

import json

import httpx

from app.config import Settings
from app.generation.targets import registry
from app.generation.validation import envelope_model, raw_items, validate_items
from app.llm.factory import build_llm
from app.llm.openai import OpenAIStructuredLLM
from app.llm.openrouter import OpenRouterStructuredLLM

# One good item and one with two correct options on a single-answer pick.
ANSWER = {
    "questions": [
        {"type": "true_false", "title": "Plants make oxygen.", "answer": True},
        {
            "type": "pick_answer_single",
            "title": "Which gas is produced?",
            "options": [{"text": "O2", "correct": True}, {"text": "Oxygen", "correct": True}],
        },
    ]
}


def chat_endpoint(message: dict, sent: list[dict]) -> httpx.AsyncClient:
    """An OpenAI-style /chat/completions that answers with `message` and records each request body."""

    def handler(request: httpx.Request) -> httpx.Response:
        sent.append(json.loads(request.content))
        return httpx.Response(
            200,
            json={
                "id": "gen-1",
                "object": "chat.completion",
                "created": 0,
                "model": "test-model",
                "system_fingerprint": None,
                "choices": [{"index": 0, "finish_reason": "stop", "message": {"role": "assistant", **message}}],
                "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2},
            },
        )

    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


def tool_call(name: str, arguments: dict) -> dict:
    return {
        "content": "",
        "tool_calls": [{"id": "call_1", "type": "function", "function": {"name": name, "arguments": json.dumps(arguments)}}],
    }


async def keeps(llm) -> list[str]:
    spec = registry.get("quiz")
    output = await llm.generate("system", "prompt", envelope_model(spec))
    result = validate_items(spec, raw_items(output), requested_types=["true_false", "pick_answer_single"])
    return [item.type for item in result.items]


async def test_openrouter_one_bad_item_does_not_fail_the_answer():
    sent: list[dict] = []
    http = chat_endpoint(tool_call("QuizEnvelope", ANSWER), sent)
    llm = OpenRouterStructuredLLM(api_key="k", model="anthropic/claude-sonnet-4.5", max_tokens=16_000, http_client=http)

    assert await keeps(llm) == ["true_false"]
    body = sent[0]
    assert body["model"] == "anthropic/claude-sonnet-4.5"
    assert body["max_tokens"] == 16_000
    assert body["tool_choice"]["function"]["name"] == "QuizEnvelope"
    # Refs inlined: the schema reads the same to every model behind OpenRouter.
    assert "$ref" not in json.dumps(body["tools"][0]["function"]["parameters"])


async def test_openrouter_json_schema_method():
    sent: list[dict] = []
    http = chat_endpoint({"content": json.dumps(ANSWER)}, sent)
    llm = OpenRouterStructuredLLM(api_key="k", model="m", method="json_schema", http_client=http)

    assert await keeps(llm) == ["true_false"]
    assert sent[0]["response_format"]["json_schema"]["name"] == "QuizEnvelope"


async def test_openai_one_bad_item_does_not_fail_the_answer():
    sent: list[dict] = []
    http = chat_endpoint({"content": json.dumps(ANSWER), "refusal": None}, sent)
    llm = OpenAIStructuredLLM(api_key="k", model="gpt-4o", max_retries=0, http_client=http)

    assert await keeps(llm) == ["true_false"]
    response_format = sent[0]["response_format"]
    assert response_format["type"] == "json_schema"
    assert response_format["json_schema"]["name"] == "QuizEnvelope"
    assert response_format["json_schema"]["strict"] is False


async def test_text_that_is_not_json_yields_no_items():
    http = chat_endpoint({"content": "sorry", "refusal": None}, [])
    llm = OpenAIStructuredLLM(api_key="k", model="gpt-4o", max_retries=0, http_client=http)
    output = await llm.generate("system", "prompt", envelope_model(registry.get("quiz")))
    assert raw_items(output) == []


def test_factory_builds_the_configured_provider():
    settings = Settings(_env_file=None, openrouter_api_key="k", openai_api_key="k")
    assert isinstance(build_llm(settings), OpenRouterStructuredLLM)
    assert build_llm(settings).model_name == "anthropic/claude-sonnet-4.5"
    assert isinstance(build_llm(settings.model_copy(update={"llm_provider": "openai"})), OpenAIStructuredLLM)

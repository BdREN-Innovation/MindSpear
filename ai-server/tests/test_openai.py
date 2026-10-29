import json

import httpx

from app.generation.targets import registry
from app.generation.validation import envelope_model, raw_items, validate_items
from app.llm.openai import OpenAIStructuredLLM

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


def openai_answering(content: str, sent: list[dict]) -> httpx.AsyncClient:
    def handler(request: httpx.Request) -> httpx.Response:
        sent.append(json.loads(request.content))
        return httpx.Response(
            200,
            json={
                "id": "chatcmpl-1",
                "object": "chat.completion",
                "created": 0,
                "model": "gpt-4o",
                "choices": [
                    {"index": 0, "finish_reason": "stop", "message": {"role": "assistant", "content": content, "refusal": None}}
                ],
                "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2},
            },
        )

    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


async def test_one_bad_item_does_not_fail_the_answer():
    sent: list[dict] = []
    llm = OpenAIStructuredLLM(api_key="k", model="gpt-4o", max_retries=0, http_client=openai_answering(json.dumps(ANSWER), sent))
    spec = registry.get("quiz")

    output = await llm.generate("system", "prompt", envelope_model(spec))
    result = validate_items(spec, raw_items(output), requested_types=["true_false", "pick_answer_single"])

    assert [item.type for item in result.items] == ["true_false"]
    assert result.rejected == 1
    response_format = sent[0]["response_format"]
    assert response_format["type"] == "json_schema"
    assert response_format["json_schema"]["name"] == "QuizEnvelope"
    assert response_format["json_schema"]["strict"] is False


async def test_text_that_is_not_json_yields_no_items():
    llm = OpenAIStructuredLLM(api_key="k", model="gpt-4o", max_retries=0, http_client=openai_answering("sorry", []))
    output = await llm.generate("system", "prompt", envelope_model(registry.get("quiz")))
    assert raw_items(output) == []

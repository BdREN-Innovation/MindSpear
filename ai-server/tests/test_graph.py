import pytest

from app.errors import NoUsableOutputError, UpstreamError
from app.generation.service import GenerationService
from tests.conftest import FakeLLM, make_graph, make_request, settings_for_tests


def fun(*texts: str) -> dict:
    return {"questions": [{"text": t, "options": ["A", "B", "C", "D"], "answer": 0} for t in texts]}


async def run(llm: FakeLLM, request, **policy):
    service = GenerationService(
        make_graph(llm, **policy), __import__("app.generation.targets", fromlist=["registry"]).registry, settings_for_tests()
    )
    return await service.generate(request)


async def test_happy_path_slices_to_the_requested_count():
    llm = FakeLLM(fun("Q1?", "Q2?", "Q3?", "Q4?"))
    res = await run(llm, make_request("fungame", questionCount=3))

    assert [q["text"] for q in res.questions] == ["Q1?", "Q2?", "Q3?"]
    assert res.meta.llm_calls == 1
    assert res.meta.generated == 3
    assert res.meta.model == "fake-model"
    assert llm.schemas[0].__name__ == "FungameEnvelope"


async def test_retries_once_when_nothing_is_usable_then_gives_up():
    llm = FakeLLM("garbage", "still garbage")
    with pytest.raises(NoUsableOutputError):
        await run(llm, make_request("fungame"), max_attempts=2)
    assert len(llm.prompts) == 2
    assert llm.prompts[0] == llm.prompts[1]


async def test_retry_succeeds_on_second_call():
    llm = FakeLLM({"questions": []}, fun("Q1?", "Q2?", "Q3?"))
    res = await run(llm, make_request("fungame", questionCount=3))
    assert res.meta.llm_calls == 2
    assert res.meta.generated == 3


async def test_topup_fills_the_shortfall_without_repeats():
    llm = FakeLLM(fun("Q1?", "Q2?"), fun("q1?", "Q3?", "Q4?"))
    res = await run(llm, make_request("fungame", questionCount=4), max_topups=1)

    assert [q["text"] for q in res.questions] == ["Q1?", "Q2?", "Q3?", "Q4?"]
    assert res.meta.llm_calls == 2
    assert res.meta.rejected == 1  # the repeated "q1?"
    assert "Total items: 2 (generate exactly this many)" in llm.prompts[1]
    assert "- Q1?" in llm.prompts[1] and "- Q2?" in llm.prompts[1]


async def test_failed_topup_returns_the_items_already_written():
    class TopupFails(FakeLLM):
        async def generate(self, system, prompt, schema):
            if self.prompts:
                self.prompts.append(prompt)
                raise UpstreamError("down")
            return await super().generate(system, prompt, schema)

    llm = TopupFails(fun("Q1?", "Q2?"))
    res = await run(llm, make_request("fungame", questionCount=4), max_topups=2)

    assert [q["text"] for q in res.questions] == ["Q1?", "Q2?"]
    assert res.meta.llm_calls == 2


async def test_first_call_failure_is_still_an_error():
    class Down(FakeLLM):
        async def generate(self, system, prompt, schema):
            raise UpstreamError("down")

    with pytest.raises(UpstreamError):
        await run(Down(), make_request("fungame"))


async def test_no_topup_when_disabled():
    llm = FakeLLM(fun("Q1?"))
    res = await run(llm, make_request("fungame", questionCount=4), max_topups=0)
    assert res.meta.llm_calls == 1
    assert res.meta.generated == 1


async def test_quiz_round_trip_returns_json_shapes():
    answer = {
        "questions": [
            {"type": "true_false", "title": "Plants make oxygen.", "answer": True, "explanation": "ignored extra key"},
            {"type": "correct_order", "title": "Order the steps", "items": ["light", "water split", "sugar"]},
        ]
    }
    llm = FakeLLM(answer)
    res = await run(llm, make_request("quiz", questionCount=2, questionTypes=["true_false", "correct_order"]))

    assert res.questions == [
        {"type": "true_false", "title": "Plants make oxygen.", "answer": True},
        {"type": "correct_order", "title": "Order the steps", "items": ["light", "water split", "sugar"]},
    ]

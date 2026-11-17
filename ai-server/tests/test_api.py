from app.generation.targets import registry
from tests.conftest import MATERIAL, FakeLLM


def body(**overrides):
    data = {
        "target": "quiz",
        "textData": MATERIAL,
        "topic": "Photosynthesis",
        "questionCount": 2,
        "questionTypes": ["pick_answer_single", "true_false"],
        "difficulty": "Easy",
        "audienceLevel": "School",
        "focusArea": "",
    }
    data.update(overrides)
    return data


QUIZ_ANSWER = {
    "questions": [
        {
            "type": "pick_answer_single",
            "title": "Where does it happen?",
            "options": [
                {"text": "Chloroplast", "correct": True},
                {"text": "Nucleus", "correct": False},
                {"text": "Vacuole", "correct": False},
                {"text": "Wall", "correct": False},
            ],
        },
        {"type": "true_false", "title": "Plants release oxygen.", "answer": True},
    ]
}


def test_health(client_factory):
    client = client_factory(FakeLLM(QUIZ_ANSWER))
    assert client.get("/health").json() == {"status": "ok"}


def test_targets_lists_every_registered_target(client_factory):
    client = client_factory(FakeLLM(QUIZ_ANSWER))
    data = client.get("/v1/targets").json()
    assert [t["key"] for t in data["targets"]] == registry.keys()
    quiz = next(t for t in data["targets"] if t["key"] == "quiz")
    assert {
        "value": "short_answer",
        "label": "Short answer",
        "hint": "Typed answer, up to 5 accepted spellings",
        "default": True,
    } in quiz["question_types"]
    assert data["limits"]["max_questions"] == 30


def test_generate_returns_target_and_questions(client_factory):
    client = client_factory(FakeLLM(QUIZ_ANSWER))
    res = client.post("/v1/generate", json=body())
    assert res.status_code == 200, res.text
    data = res.json()
    assert data["target"] == "quiz"
    assert len(data["questions"]) == 2
    assert data["questions"][1] == {"type": "true_false", "title": "Plants release oxygen.", "answer": True}
    assert data["meta"]["llm_calls"] == 1


def test_validation_errors_use_the_error_key(client_factory):
    client = client_factory(FakeLLM(QUIZ_ANSWER))
    res = client.post("/v1/generate", json=body(topic=""))
    assert res.status_code == 422
    assert res.json()["error"].startswith("topic:")

    res = client.post("/v1/generate", json=body(questionCount=99))
    assert res.status_code == 422
    assert "between 1 and 30" in res.json()["error"]

    res = client.post("/v1/generate", json=body(target="nope"))
    assert res.status_code == 422
    assert "Unknown target" in res.json()["error"]


def test_missing_token_is_rejected_when_auth_is_on(client_factory):
    client = client_factory(FakeLLM(QUIZ_ANSWER), auth_disabled=False, laravel_api_url="http://laravel.test/api/v1")
    res = client.post("/v1/generate", json=body())
    assert res.status_code == 401
    assert res.json() == {"error": "Please sign in again to generate questions."}


def test_rate_limit(client_factory):
    client = client_factory(FakeLLM(QUIZ_ANSWER), rate_limit_per_minute=2)
    assert client.post("/v1/generate", json=body()).status_code == 200
    assert client.post("/v1/generate", json=body()).status_code == 200
    res = client.post("/v1/generate", json=body())
    assert res.status_code == 429
    assert "too quickly" in res.json()["error"]


def test_unusable_answer_is_a_502(client_factory):
    client = client_factory(FakeLLM("no json here"))
    res = client.post("/v1/generate", json=body())
    assert res.status_code == 502
    assert "couldn't write questions" in res.json()["error"]

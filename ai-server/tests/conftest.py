from __future__ import annotations

import json
from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from pydantic import BaseModel

from app.config import Settings
from app.generation.graph.workflow import GenerationGraph, GenerationPolicy
from app.generation.schemas.request import GenerateRequest
from app.generation.targets import registry
from app.llm.base import LLMOutput
from app.main import create_app

MATERIAL = (
    "Photosynthesis is the process by which green plants use sunlight to synthesise foods from carbon dioxide and "
    "water. It takes place in the chloroplasts and produces oxygen as a by-product. Chlorophyll absorbs mostly blue "
    "and red light, which is why leaves look green."
)


class FakeLLM:
    """Answers with scripted outputs, in order; the last one repeats. Records every prompt."""

    model_name = "fake-model"

    def __init__(self, *answers: Any) -> None:
        self._answers = list(answers)
        self.prompts: list[str] = []
        self.schemas: list[type[BaseModel]] = []

    async def generate(self, system: str, prompt: str, schema: type[BaseModel]) -> LLMOutput:
        self.prompts.append(prompt)
        self.schemas.append(schema)
        answer = self._answers.pop(0) if len(self._answers) > 1 else self._answers[0]
        raw = answer if isinstance(answer, str) else json.dumps(answer)
        return LLMOutput(parsed=None, raw_text=raw)


def make_request(target: str = "quiz", **overrides: Any) -> GenerateRequest:
    data = {
        "target": target,
        "textData": MATERIAL,
        "topic": "Photosynthesis",
        "questionCount": 3,
        "questionTypes": registry.get(target).default_type_keys if target in registry else ["single_choice"],
        "difficulty": "Medium",
        "audienceLevel": "College",
        "focusArea": "",
    }
    data.update(overrides)
    return GenerateRequest.model_validate(data)


def make_graph(llm: FakeLLM, *, max_attempts: int = 2, max_topups: int = 1) -> GenerationGraph:
    return GenerationGraph(llm, registry, GenerationPolicy(max_attempts=max_attempts, max_topups=max_topups))


def settings_for_tests(**overrides: Any) -> Settings:
    base = {"app_env": "test", "auth_disabled": True, "openai_api_key": "test", "cors_origins": ""}
    base.update(overrides)
    return Settings(_env_file=None, **base)


@pytest.fixture
def client_factory() -> Iterator[Any]:
    clients: list[TestClient] = []

    def factory(llm: FakeLLM, **settings: Any) -> TestClient:
        client = TestClient(create_app(settings_for_tests(**settings), llm=llm))
        client.__enter__()
        clients.append(client)
        return client

    yield factory
    for client in clients:
        client.__exit__(None, None, None)

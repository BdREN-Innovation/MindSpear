from __future__ import annotations

from typing import Any, TypedDict

from pydantic import BaseModel

from app.generation.schemas.request import GenerateRequest


class GenerationState(TypedDict, total=False):
    request: GenerateRequest
    prompt: str
    #: The latest answer, as items the validator has not seen yet.
    candidates: list[Any]
    #: Validated items collected so far.
    items: list[BaseModel]
    #: text_key of every kept item, so later calls do not repeat them.
    seen_keys: set[str]
    llm_calls: int
    topups: int
    rejected: int
    model: str

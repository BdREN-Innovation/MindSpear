from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class GenerationMeta(BaseModel):
    requested: int
    generated: int
    #: LLM calls made, including retries and top-ups.
    llm_calls: int
    #: Items the model wrote that failed validation or repeated another.
    rejected: int
    model: str


class GenerateResponse(BaseModel):
    target: str
    questions: list[dict[str, Any]]
    meta: GenerationMeta


class QuestionTypeInfo(BaseModel):
    value: str
    label: str
    hint: str | None = None
    default: bool = True


class TargetInfo(BaseModel):
    key: str
    noun: dict[str, str]
    question_types: list[QuestionTypeInfo]


class TargetsResponse(BaseModel):
    targets: list[TargetInfo]
    limits: dict[str, int] = Field(default_factory=dict)

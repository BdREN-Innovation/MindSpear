"""The use case: a validated request in, a response of validated items out."""

from __future__ import annotations

from app.config import Settings
from app.errors import NoUsableOutputError, ValidationError
from app.generation.graph.workflow import GenerationGraph
from app.generation.registry import TargetRegistry
from app.generation.schemas.request import GenerateRequest
from app.generation.schemas.response import (
    GenerateResponse,
    GenerationMeta,
    QuestionTypeInfo,
    TargetInfo,
    TargetsResponse,
)


class GenerationService:
    def __init__(self, graph: GenerationGraph, registry: TargetRegistry, settings: Settings) -> None:
        self._graph = graph
        self._registry = registry
        self._settings = settings

    async def generate(self, request: GenerateRequest) -> GenerateResponse:
        s = self._settings
        try:
            request = request.limited(
                max_questions=s.max_questions, max_text_chars=s.max_text_chars, min_text_chars=s.min_text_chars
            )
        except ValueError as exc:
            raise ValidationError(str(exc)) from exc

        state = await self._graph.compiled.ainvoke({"request": request})
        items = state["items"][: request.question_count]
        if not items:
            raise NoUsableOutputError(
                "The AI couldn't write questions from this text. Try other pages or a clearer topic."
            )
        return GenerateResponse(
            target=request.target,
            questions=[item.model_dump(mode="json") for item in items],
            meta=GenerationMeta(
                requested=request.question_count,
                generated=len(items),
                llm_calls=state["llm_calls"],
                rejected=state["rejected"],
                model=state["model"],
            ),
        )

    def targets(self) -> TargetsResponse:
        s = self._settings
        return TargetsResponse(
            targets=[
                TargetInfo(
                    key=spec.key,
                    noun={"singular": spec.noun.singular, "plural": spec.noun.plural},
                    question_types=[
                        QuestionTypeInfo(value=qt.key, label=qt.label, hint=qt.hint, default=qt.default)
                        for qt in spec.question_types
                    ],
                )
                for spec in self._registry
            ],
            limits={
                "max_questions": s.max_questions,
                "max_text_chars": s.max_text_chars,
                "min_text_chars": s.min_text_chars,
            },
        )

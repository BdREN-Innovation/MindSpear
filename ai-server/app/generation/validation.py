"""Turns a model answer into validated items of the target, dropping what is wrong."""

from __future__ import annotations

import json
import logging
import re
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from typing import Any

from pydantic import BaseModel, TypeAdapter, ValidationError, create_model

from app.generation.schemas.common import text_key
from app.generation.types import TargetSpec
from app.llm.base import LLMOutput

log = logging.getLogger(__name__)

_FENCE = re.compile(r"^```(?:json)?\s*|\s*```$", re.IGNORECASE)


_envelopes: dict[str, type[BaseModel]] = {}
_adapters: dict[str, TypeAdapter[Any]] = {}


def envelope_model(spec: TargetSpec) -> type[BaseModel]:
    """`{"questions": [<item>, ...]}` for the target: what the LLM is asked to produce."""
    if spec.key not in _envelopes:
        name = "".join(part.capitalize() for part in spec.key.split("_")) + "Envelope"
        _envelopes[spec.key] = create_model(name, questions=(list[spec.item_schema], ...))  # type: ignore[valid-type]
    return _envelopes[spec.key]


def item_adapter(spec: TargetSpec) -> TypeAdapter[Any]:
    if spec.key not in _adapters:
        _adapters[spec.key] = TypeAdapter(spec.item_schema)
    return _adapters[spec.key]


def raw_items(output: LLMOutput) -> list[Any]:
    """The list of items in the answer: parsed when the provider managed, else read from the text."""
    data = output.parsed
    if isinstance(data, BaseModel):
        data = data.model_dump()
    if data is None:
        text = _FENCE.sub("", output.raw_text.strip())
        if not text:
            return []
        try:
            data = json.loads(text)
        except json.JSONDecodeError:
            log.warning("LLM answer is not JSON (first 200 chars): %r", text[:200])
            return []
    if isinstance(data, list):
        return data
    if isinstance(data, dict) and isinstance(data.get("questions"), list):
        return data["questions"]
    return []


@dataclass(slots=True)
class ValidationResult:
    items: list[BaseModel] = field(default_factory=list)
    rejected: int = 0
    #: Why items were rejected (first few, for logs and tests).
    reasons: list[str] = field(default_factory=list)


def validate_items(
    spec: TargetSpec,
    candidates: Iterable[Any],
    *,
    requested_types: Sequence[str],
    seen_keys: set[str] | None = None,
) -> ValidationResult:
    """
    Keeps the items that validate, are of a requested type and are not
    repeats (of each other, or of `seen_keys` from an earlier call). The model
    occasionally gets one wrong; the rest are still worth keeping.
    """
    wanted = set(requested_types)
    seen = seen_keys if seen_keys is not None else set()
    adapter = item_adapter(spec)
    result = ValidationResult()

    for candidate in candidates:
        item_type = spec.item_type(candidate) if isinstance(candidate, dict | BaseModel) else None
        if spec.type_field is not None and item_type not in wanted:
            result.rejected += 1
            result.reasons.append(f"type '{item_type}' was not requested")
            continue
        try:
            item = adapter.validate_python(candidate)
        except ValidationError as exc:
            result.rejected += 1
            result.reasons.append(exc.errors()[0].get("msg", "invalid") if exc.errors() else "invalid")
            continue
        if spec.normalise is not None:
            item = spec.normalise(item)
        key = text_key(spec.item_text(item))
        if not key or key in seen:
            result.rejected += 1
            result.reasons.append("repeated item")
            continue
        seen.add(key)
        result.items.append(item)

    return result

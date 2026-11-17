"""The one thing the graph needs from a language model."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol

from pydantic import BaseModel


@dataclass(frozen=True, slots=True)
class LLMOutput:
    """
    `parsed` is the answer as JSON data (a dict, a list or a model) when the
    provider parsed it; `raw_text` is the answer text, read when it did not.
    Neither is validated: validation.py checks the items one by one.
    """

    parsed: Any
    raw_text: str


class StructuredLLM(Protocol):
    @property
    def model_name(self) -> str: ...

    async def generate(self, system: str, prompt: str, schema: type[BaseModel]) -> LLMOutput:
        """
        Asks for a JSON answer in the shape of `schema`. Must not validate the
        answer against `schema`: one bad item would throw away the good ones.
        Raises UpstreamError when the service fails.
        """
        ...

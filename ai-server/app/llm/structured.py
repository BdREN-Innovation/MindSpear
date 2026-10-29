"""
The StructuredLLM over a LangChain chat model. A provider module only builds
its chat model (and may adapt the schema); asking for the answer, keeping it
unvalidated and turning failures into UpstreamError happen here.
"""

from __future__ import annotations

import logging
from typing import Any

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_core.runnables import Runnable
from langchain_core.utils.json_schema import dereference_refs
from pydantic import BaseModel

from app.config import StructuredMethod
from app.errors import UpstreamError
from app.llm.base import LLMOutput

log = logging.getLogger(__name__)


def _text_of(content: Any) -> str:
    """Message content as text (OpenAI returns a string; some models return content blocks)."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(block if isinstance(block, str) else str(block.get("text", "")) for block in content if block)
    return "" if content is None else str(content)


class LangChainStructuredLLM:
    def __init__(self, chat: BaseChatModel, *, model: str, method: StructuredMethod, strict: bool) -> None:
        self._chat = chat
        self._model = model
        self._method = method
        self._strict = strict
        self._structured: dict[type[BaseModel], Runnable] = {}

    @property
    def model_name(self) -> str:
        return self._model

    def json_schema(self, schema: type[BaseModel]) -> dict[str, Any]:
        """The schema the model is asked to follow, $refs inlined (not every model behind OpenRouter reads them)."""
        inlined = dereference_refs(schema.model_json_schema())
        inlined.pop("$defs", None)
        return inlined

    def _runnable(self, schema: type[BaseModel]) -> Runnable:
        if schema not in self._structured:
            # The JSON schema, not the model class: given the class, LangChain (or the provider's SDK)
            # validates the whole answer and one bad item fails the call, so nothing could be salvaged.
            kwargs: dict[str, Any] = {"method": self._method, "include_raw": True}
            if self._strict and self._method != "json_mode":
                kwargs["strict"] = True
            self._structured[schema] = self._chat.with_structured_output(self.json_schema(schema), **kwargs)
        return self._structured[schema]

    async def generate(self, system: str, prompt: str, schema: type[BaseModel]) -> LLMOutput:
        try:
            result = await self._runnable(schema).ainvoke([SystemMessage(content=system), HumanMessage(content=prompt)])
        except Exception as exc:  # every SDK raises its own classes; all mean "try again later"
            log.error("LLM request failed (%s): %s", type(exc).__name__, exc)
            raise UpstreamError("The AI service is unavailable right now. Please try again shortly.") from exc

        raw = result.get("raw")
        if result.get("parsing_error"):
            log.warning("LLM answer is not valid JSON: %s", result["parsing_error"])
        return LLMOutput(parsed=result.get("parsed"), raw_text=_text_of(getattr(raw, "content", "")))

"""OpenAI (and OpenAI-compatible endpoints) through LangChain."""

from __future__ import annotations

import logging
from typing import Any

import httpx
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_core.runnables import Runnable
from langchain_openai import ChatOpenAI
from openai.lib._pydantic import to_strict_json_schema
from pydantic import BaseModel

from app.config import Settings, StructuredMethod
from app.errors import ConfigurationError, UpstreamError
from app.llm.base import LLMOutput

log = logging.getLogger(__name__)


def _text_of(content: Any) -> str:
    """Message content as text (OpenAI returns a string; some models return content blocks)."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(block if isinstance(block, str) else str(block.get("text", "")) for block in content if block)
    return "" if content is None else str(content)


class OpenAIStructuredLLM:
    def __init__(
        self,
        *,
        api_key: str,
        model: str,
        base_url: str = "",
        temperature: float = 0.7,
        timeout: float = 90.0,
        max_retries: int = 1,
        method: StructuredMethod = "json_schema",
        strict: bool = False,
        http_client: httpx.AsyncClient | None = None,
    ) -> None:
        if not api_key:
            raise ConfigurationError("AI generation is not configured on this server (OPENAI_API_KEY is empty).")
        self._model = model
        self._method = method
        self._strict = strict
        self._chat = ChatOpenAI(
            model=model,
            api_key=api_key,
            base_url=base_url or None,
            temperature=temperature,
            timeout=timeout,
            max_retries=max_retries,
            http_async_client=http_client,
        )
        self._structured: dict[type[BaseModel], Runnable] = {}

    @classmethod
    def from_settings(cls, settings: Settings) -> OpenAIStructuredLLM:
        return cls(
            api_key=settings.openai_api_key,
            model=settings.openai_model,
            base_url=settings.openai_base_url,
            temperature=settings.llm_temperature,
            timeout=settings.llm_timeout_seconds,
            max_retries=settings.llm_max_retries,
            method=settings.llm_structured_method,
            strict=settings.llm_strict_schema,
        )

    @property
    def model_name(self) -> str:
        return self._model

    def _runnable(self, schema: type[BaseModel]) -> Runnable:
        if schema not in self._structured:
            # The JSON schema, not the model class: given the class, the OpenAI SDK validates the
            # whole answer and one bad item fails the call, so nothing could be salvaged.
            json_schema = to_strict_json_schema(schema) if self._strict else schema.model_json_schema()
            kwargs: dict[str, Any] = {"method": self._method, "include_raw": True}
            if self._method != "json_mode":
                kwargs["strict"] = self._strict
            self._structured[schema] = self._chat.with_structured_output(json_schema, **kwargs)
        return self._structured[schema]

    async def generate(self, system: str, prompt: str, schema: type[BaseModel]) -> LLMOutput:
        try:
            result = await self._runnable(schema).ainvoke([SystemMessage(content=system), HumanMessage(content=prompt)])
        except Exception as exc:  # the OpenAI SDK raises many classes; all mean "try again later"
            log.error("LLM request failed (%s): %s", type(exc).__name__, exc)
            raise UpstreamError("The AI service is unavailable right now. Please try again shortly.") from exc

        raw = result.get("raw")
        if result.get("parsing_error"):
            log.warning("LLM answer is not valid JSON: %s", result["parsing_error"])
        return LLMOutput(parsed=result.get("parsed"), raw_text=_text_of(getattr(raw, "content", "")))

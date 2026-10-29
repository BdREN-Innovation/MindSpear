"""OpenAI (and OpenAI-compatible endpoints) through LangChain."""

from __future__ import annotations

from typing import Any

import httpx
from langchain_openai import ChatOpenAI
from openai.lib._pydantic import to_strict_json_schema
from pydantic import BaseModel

from app.config import Settings, StructuredMethod
from app.errors import ConfigurationError
from app.llm.structured import LangChainStructuredLLM


class OpenAIStructuredLLM(LangChainStructuredLLM):
    def __init__(
        self,
        *,
        api_key: str,
        model: str,
        base_url: str = "",
        temperature: float = 0.7,
        timeout: float = 90.0,
        max_retries: int = 1,
        max_tokens: int | None = None,
        method: StructuredMethod = "json_schema",
        strict: bool = False,
        http_client: httpx.AsyncClient | None = None,
    ) -> None:
        if not api_key:
            raise ConfigurationError("AI generation is not configured on this server (OPENAI_API_KEY is empty).")
        chat = ChatOpenAI(
            model=model,
            api_key=api_key,
            base_url=base_url or None,
            temperature=temperature,
            timeout=timeout,
            max_retries=max_retries,
            max_tokens=max_tokens,
            http_async_client=http_client,
        )
        super().__init__(chat, model=model, method=method, strict=strict)

    @classmethod
    def from_settings(cls, settings: Settings) -> OpenAIStructuredLLM:
        return cls(
            api_key=settings.openai_api_key,
            model=settings.openai_model,
            base_url=settings.openai_base_url,
            temperature=settings.llm_temperature,
            timeout=settings.llm_timeout_seconds,
            max_retries=settings.llm_max_retries,
            max_tokens=settings.llm_max_tokens,
            method=settings.llm_structured_method,
            strict=settings.llm_strict_schema,
        )

    def json_schema(self, schema: type[BaseModel]) -> dict[str, Any]:
        # Strict mode wants every property required and no extra keys: the SDK's own helper does that.
        return to_strict_json_schema(schema) if self._strict else super().json_schema(schema)

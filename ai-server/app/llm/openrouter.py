"""Any model OpenRouter serves (Anthropic, OpenAI, Google ...) through LangChain."""

from __future__ import annotations

import httpx
import openrouter
from langchain_openrouter import ChatOpenRouter

from app.config import Settings, StructuredMethod
from app.errors import ConfigurationError
from app.llm.structured import LangChainStructuredLLM


class OpenRouterStructuredLLM(LangChainStructuredLLM):
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
        method: StructuredMethod = "function_calling",
        strict: bool = False,
        app_title: str | None = None,
        app_url: str | None = None,
        http_client: httpx.AsyncClient | None = None,
    ) -> None:
        """`http_client` (tests) replaces the SDK client, and with it the timeout and retry settings."""
        if not api_key:
            raise ConfigurationError("AI generation is not configured on this server (OPENROUTER_API_KEY is empty).")
        client = None
        if http_client is not None:
            client = openrouter.OpenRouter(api_key=api_key, server_url=base_url or None, async_client=http_client)
        chat = ChatOpenRouter(
            model=model,
            api_key=api_key,
            base_url=base_url or None,
            temperature=temperature,
            # Milliseconds. Each retry is a ~150 s backoff window in the SDK, not one more attempt.
            timeout=round(timeout * 1000),
            max_retries=max_retries,
            max_tokens=max_tokens,
            # Attribution in the OpenRouter dashboard (it would otherwise say "LangChain").
            app_title=app_title,
            app_url=app_url,
            client=client,
        )
        super().__init__(chat, model=model, method=method, strict=strict)

    @classmethod
    def from_settings(cls, settings: Settings) -> OpenRouterStructuredLLM:
        return cls(
            api_key=settings.openrouter_api_key,
            model=settings.openrouter_model,
            base_url=settings.openrouter_base_url,
            temperature=settings.llm_temperature,
            timeout=settings.llm_timeout_seconds,
            max_retries=settings.llm_max_retries,
            max_tokens=settings.llm_max_tokens,
            method=settings.llm_structured_method,
            strict=settings.llm_strict_schema,
            app_title=settings.app_name,
            app_url=settings.openrouter_app_url or None,
        )

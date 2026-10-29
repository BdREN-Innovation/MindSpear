from __future__ import annotations

from app.config import Settings
from app.errors import ConfigurationError
from app.llm.base import StructuredLLM
from app.llm.openai import OpenAIStructuredLLM
from app.llm.openrouter import OpenRouterStructuredLLM


def build_llm(settings: Settings) -> StructuredLLM:
    """The configured provider. Add a branch (and a module in app/llm) for a new one."""
    if settings.llm_provider == "openrouter":
        return OpenRouterStructuredLLM.from_settings(settings)
    if settings.llm_provider == "openai":
        return OpenAIStructuredLLM.from_settings(settings)
    raise ConfigurationError(f"Unknown LLM provider '{settings.llm_provider}'.")

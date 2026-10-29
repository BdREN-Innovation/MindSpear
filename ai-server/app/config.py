"""Settings, read from the environment (and a local .env file in development)."""

from functools import lru_cache
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

StructuredMethod = Literal["json_schema", "json_mode", "function_calling"]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "MindSpear AI"
    app_env: Literal["development", "production", "test"] = "development"
    log_level: str = "info"
    #: Comma-separated browser origins allowed to call this server; empty = CORS off.
    cors_origins: str = ""

    # Sign-in check against the Laravel API.
    laravel_api_url: str = ""
    auth_disabled: bool = False
    auth_cache_seconds: int = 60
    auth_timeout_seconds: float = 10.0
    rate_limit_per_minute: int = 10

    # LLM.
    llm_provider: Literal["openai"] = "openai"
    openai_api_key: str = ""
    openai_model: str = "gpt-4o"
    openai_base_url: str = ""
    llm_temperature: float = 0.7
    llm_timeout_seconds: float = 90.0
    llm_max_retries: int = 1
    llm_structured_method: StructuredMethod = "json_schema"
    llm_strict_schema: bool = False

    # Generation.
    generation_max_attempts: int = Field(default=2, ge=1, le=5)
    generation_max_topups: int = Field(default=1, ge=0, le=3)
    max_questions: int = Field(default=30, ge=1, le=100)
    max_text_chars: int = Field(default=60_000, ge=1_000)
    min_text_chars: int = Field(default=40, ge=1)

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @field_validator("laravel_api_url", "openai_base_url", mode="before")
    @classmethod
    def _strip_trailing_slash(cls, value: object) -> object:
        return value.rstrip("/") if isinstance(value, str) else value


@lru_cache
def get_settings() -> Settings:
    return Settings()

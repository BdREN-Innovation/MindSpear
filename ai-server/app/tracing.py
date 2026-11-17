"""
Langfuse tracing (LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY, LANGFUSE_BASE_URL).

One /v1/generate request is one trace: the LangGraph run with its nodes and,
inside them, every model call with its prompt, answer, token use and latency.
The Langfuse callback rides on the graph's run config, and LangChain hands it
down to the model call by itself. Without both keys tracing is off.

Langfuse gets a tracer provider of its own instead of the global one, so
spans other libraries emit (FastAPI traces every request, health checks
included) never reach it; a generation trace starts at "generate {target}".

Traces hold the selected document text and the generated questions, so the
Langfuse project must be one that may keep users' documents.
"""

from __future__ import annotations

import logging
from typing import Any

from langchain_core.runnables import RunnableConfig

from app.config import Settings

log = logging.getLogger(__name__)


class Tracer:
    def __init__(self, settings: Settings) -> None:
        self._client: Any = None
        self._public_key = settings.langfuse_public_key
        if not (settings.langfuse_public_key and settings.langfuse_secret_key):
            return
        try:
            from langfuse import Langfuse
            from opentelemetry.sdk.trace import TracerProvider

            self._client = Langfuse(
                public_key=settings.langfuse_public_key,
                secret_key=settings.langfuse_secret_key,
                base_url=settings.langfuse_base_url,
                environment=settings.app_env,
                tracer_provider=TracerProvider(),
            )
        except Exception as exc:  # tracing must never stop the server
            log.warning("Langfuse tracing is off: %s", exc)

    @property
    def enabled(self) -> bool:
        return self._client is not None

    def run_config(self, name: str, *, user_id: str | None, tags: list[str], metadata: dict[str, Any]) -> RunnableConfig:
        """The config for one traced graph run (a plain run name when tracing is off)."""
        if not self._client:
            return {"run_name": name}
        from langfuse.langchain import CallbackHandler

        trace_metadata: dict[str, Any] = {"langfuse_tags": tags, **metadata}
        if user_id:
            trace_metadata["langfuse_user_id"] = user_id
        # A handler per run: it keeps the state of the run it traces.
        return {"run_name": name, "callbacks": [CallbackHandler(public_key=self._public_key)], "metadata": trace_metadata}

    def shutdown(self) -> None:
        """Sends what is still buffered (on server shutdown)."""
        if self._client:
            self._client.shutdown()

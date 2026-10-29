"""FastAPI application: wires settings, the LLM, the graph and the routes."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.routes import generate, health
from app.config import Settings, get_settings
from app.errors import AppError
from app.generation.graph.workflow import GenerationGraph, GenerationPolicy
from app.generation.service import GenerationService
from app.generation.targets import registry
from app.llm.base import StructuredLLM
from app.llm.factory import build_llm
from app.security.auth import NoAuth, TokenVerifier
from app.security.rate_limit import RateLimiter

log = logging.getLogger(__name__)


def _first_message(exc: RequestValidationError) -> str:
    errors = exc.errors()
    if not errors:
        return "Invalid request."
    first = errors[0]
    where = ".".join(str(part) for part in first.get("loc", ()) if part != "body")
    message = str(first.get("msg", "Invalid value")).removeprefix("Value error, ")
    return f"{where}: {message}" if where else message


def create_app(settings: Settings | None = None, llm: StructuredLLM | None = None) -> FastAPI:
    settings = settings or get_settings()
    logging.basicConfig(level=settings.log_level.upper())

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.settings = settings
        model = llm or build_llm(settings)
        policy = GenerationPolicy(
            max_attempts=settings.generation_max_attempts, max_topups=settings.generation_max_topups
        )
        app.state.generation = GenerationService(GenerationGraph(model, registry, policy), registry, settings)
        app.state.verifier = (
            NoAuth()
            if settings.auth_disabled
            else TokenVerifier(
                api_url=settings.laravel_api_url,
                cache_seconds=settings.auth_cache_seconds,
                timeout=settings.auth_timeout_seconds,
            )
        )
        app.state.limiter = RateLimiter(limit=settings.rate_limit_per_minute)
        if settings.auth_disabled:
            log.warning("AUTH_DISABLED is on: requests are not checked against the Laravel API.")
        log.info(
            "%s ready: provider=%s model=%s targets=%s",
            settings.app_name,
            settings.llm_provider,
            model.model_name,
            registry.keys(),
        )
        yield

    app = FastAPI(
        title=settings.app_name,
        version="0.1.0",
        docs_url="/docs" if settings.app_env != "production" else None,
        lifespan=lifespan,
    )

    if settings.cors_origin_list:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.cors_origin_list,
            allow_methods=["GET", "POST", "OPTIONS"],
            allow_headers=["Authorization", "Content-Type"],
        )

    @app.exception_handler(AppError)
    async def app_error(_: Request, exc: AppError) -> JSONResponse:
        return JSONResponse({"error": exc.message}, status_code=exc.status_code)

    @app.exception_handler(RequestValidationError)
    async def invalid_request(_: Request, exc: RequestValidationError) -> JSONResponse:
        return JSONResponse({"error": _first_message(exc), "details": jsonable_encoder(exc.errors())}, status_code=422)

    app.include_router(health.router)
    app.include_router(generate.router)
    return app


app = create_app()

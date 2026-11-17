"""FastAPI dependencies: the services built at startup, and the signed-in user."""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends, Header, Request

from app.generation.service import GenerationService
from app.security.auth import NoAuth, TokenVerifier, User, bearer_token
from app.security.rate_limit import RateLimiter


def get_generation_service(request: Request) -> GenerationService:
    return request.app.state.generation


async def require_user(request: Request, authorization: Annotated[str | None, Header()] = None) -> User:
    verifier: TokenVerifier | NoAuth = request.app.state.verifier
    limiter: RateLimiter = request.app.state.limiter
    token = "" if isinstance(verifier, NoAuth) else bearer_token(authorization)
    user = await verifier.verify(token)
    limiter.hit(user.key)
    return user


CurrentUser = Annotated[User, Depends(require_user)]
Generation = Annotated[GenerationService, Depends(get_generation_service)]

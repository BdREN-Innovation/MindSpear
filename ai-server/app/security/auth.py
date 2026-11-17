"""
Only signed-in users may spend AI credits. The bearer token the frontend
holds is a Laravel Sanctum token; it is checked against the Laravel API and
the result cached for a short while, keyed by a hash of the token.
"""

from __future__ import annotations

import hashlib
import time
from collections.abc import Callable
from dataclasses import dataclass

import httpx

from app.errors import AuthError, ConfigurationError, UpstreamError

Clock = Callable[[], float]


def token_key(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def bearer_token(authorization: str | None) -> str:
    header = authorization or ""
    token = header[7:].strip() if header.lower().startswith("bearer ") else ""
    if not token or token in {"null", "undefined"}:
        raise AuthError("Please sign in again to generate questions.")
    return token


@dataclass(frozen=True, slots=True)
class User:
    #: Hash of the token: identifies the caller without keeping the token.
    key: str
    #: The Laravel user id (from /profile/show), when known: names the caller in traces.
    id: str | None = None


def _profile_id(res: httpx.Response) -> str | None:
    try:
        value = res.json()["data"]["profile"]["id"]
    except (ValueError, KeyError, TypeError):
        return None
    return str(value) if value is not None else None


class TokenVerifier:
    def __init__(self, *, api_url: str, cache_seconds: int, timeout: float, clock: Clock = time.monotonic) -> None:
        self._api_url = api_url.rstrip("/")
        self._cache_seconds = cache_seconds
        self._timeout = timeout
        self._clock = clock
        #: token key → (valid until, user id)
        self._valid_until: dict[str, tuple[float, str | None]] = {}

    async def verify(self, token: str) -> User:
        key = token_key(token)
        now = self._clock()
        until, user_id = self._valid_until.get(key, (0.0, None))
        if until > now:
            return User(key, user_id)
        if not self._api_url:
            raise ConfigurationError("The API address is not configured (LARAVEL_API_URL).")

        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                res = await client.get(
                    f"{self._api_url}/profile/show",
                    headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
                )
        except httpx.HTTPError as exc:
            raise UpstreamError("Can't reach the server to check your sign-in.") from exc
        if res.status_code != 200:
            raise AuthError("Please sign in again to generate questions.")

        user_id = _profile_id(res)
        self._valid_until[key] = (now + self._cache_seconds, user_id)
        self._evict(now)
        return User(key, user_id)

    def _evict(self, now: float) -> None:
        if len(self._valid_until) > 10_000:
            self._valid_until = {k: entry for k, entry in self._valid_until.items() if entry[0] > now}


class NoAuth:
    """Development only: everybody is the same anonymous user."""

    async def verify(self, token: str) -> User:
        return User("anonymous")

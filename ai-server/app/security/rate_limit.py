"""A sliding-window limit per caller. In-memory: one process, one window."""

from __future__ import annotations

import time
from collections import deque
from collections.abc import Callable

from app.errors import RateLimitError

Clock = Callable[[], float]


class RateLimiter:
    def __init__(self, *, limit: int, window_seconds: float = 60.0, clock: Clock = time.monotonic) -> None:
        self._limit = limit
        self._window = window_seconds
        self._clock = clock
        self._calls: dict[str, deque[float]] = {}

    def hit(self, key: str) -> None:
        if self._limit <= 0:
            return
        now = self._clock()
        calls = self._calls.setdefault(key, deque())
        while calls and now - calls[0] >= self._window:
            calls.popleft()
        if len(calls) >= self._limit:
            raise RateLimitError("You're generating too quickly. Please wait a minute and try again.")
        calls.append(now)

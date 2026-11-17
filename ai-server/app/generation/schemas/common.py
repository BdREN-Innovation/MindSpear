"""Shared pieces of the item models."""

from __future__ import annotations

import re
from collections.abc import Iterable
from typing import Annotated

from pydantic import BaseModel, ConfigDict, StringConstraints

#: A non-empty string, surrounding whitespace removed.
Text = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]

_WS = re.compile(r"\s+")


def text_key(value: str) -> str:
    """Comparison key for generated text: trimmed, inner whitespace collapsed, case-folded."""
    return _WS.sub(" ", value.strip()).casefold()


class ItemModel(BaseModel):
    """
    Base of every generated item. Extra keys the model adds are ignored and
    strings are trimmed, so a slightly chatty answer still validates.
    """

    model_config = ConfigDict(extra="ignore", str_strip_whitespace=True)


def distinct(values: Iterable[str]) -> bool:
    """No two values are the same text (compared with text_key, as the frontend mapper does)."""
    keys = [text_key(value) for value in values]
    return len(keys) == len(set(keys))

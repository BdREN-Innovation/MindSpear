"""Where the generation targets live. Targets register themselves at import."""

from __future__ import annotations

from collections.abc import Iterator

from app.generation.types import TargetSpec


class TargetRegistry:
    def __init__(self) -> None:
        self._targets: dict[str, TargetSpec] = {}

    def register(self, spec: TargetSpec) -> TargetSpec:
        if spec.key in self._targets:
            raise ValueError(f"target '{spec.key}' is registered twice")
        self._targets[spec.key] = spec
        return spec

    def get(self, key: str) -> TargetSpec:
        try:
            return self._targets[key]
        except KeyError as exc:
            raise KeyError(f"unknown target '{key}'") from exc

    def keys(self) -> list[str]:
        return list(self._targets)

    def __contains__(self, key: object) -> bool:
        return key in self._targets

    def __iter__(self) -> Iterator[TargetSpec]:
        return iter(self._targets.values())

    def __len__(self) -> int:
        return len(self._targets)


registry = TargetRegistry()

"""
The building blocks a generation target is described with.

A target (quiz, quest, fungame) is a TargetSpec: the
persona and rules of its prompt, the question types it may write (each with
its own rule and output shape), and the Pydantic model that validates one
generated item. Adding a question type means adding a QuestionType (and, when
the type has its own shape, a model variant) to one target module; adding a
target means one new module registered in targets/__init__.py.
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from typing import Any

from pydantic import BaseModel

#: A Pydantic model class, or a Union of model classes, describing one generated item.
ItemSchema = Any


@dataclass(frozen=True, slots=True)
class Noun:
    singular: str
    plural: str


@dataclass(frozen=True, slots=True)
class QuestionType:
    """One kind of item a target can write."""

    key: str
    label: str
    #: The construction rule the prompt states for this type.
    rule: str
    #: JSON example of this type's output. None = the target's shared shape covers it.
    shape: str | None = None
    hint: str | None = None
    #: Pre-selected in the UI by default.
    default: bool = True


@dataclass(frozen=True, slots=True)
class TargetSpec:
    key: str
    noun: Noun
    #: How the prompt refers to the allowed types ("question types", "task types" ...).
    types_label: str
    #: Opening lines: who the model is and what it writes.
    persona: str
    question_types: Sequence[QuestionType]
    #: Validates one item; a Union of models when types have different shapes.
    item_schema: ItemSchema
    #: Rules that apply to every item, stated before the per-type rules.
    general_rules: Sequence[str] = ()
    #: Rules stated after the per-type rules.
    closing_rules: Sequence[str] = ()
    #: Output shape shared by all types; "{types}" is replaced by the allowed type keys.
    shared_shape: str | None = None
    #: Field that carries the type key on a generated item (None = items are untyped).
    type_field: str | None = "type"
    #: Fields that carry an item's own text, joined (used to drop repeats and to list what was written).
    #: More than one when the title alone can repeat, e.g. "Fill in the blanks" over different sentences.
    text_fields: Sequence[str] = ("title",)
    #: Optional cleanup of a validated item before it is returned.
    normalise: Callable[[BaseModel], BaseModel] | None = None
    #: Extra hints for API consumers (limits, notes). Free-form.
    extra: dict[str, Any] = field(default_factory=dict)

    @property
    def type_keys(self) -> list[str]:
        return [qt.key for qt in self.question_types]

    @property
    def default_type_keys(self) -> list[str]:
        return [qt.key for qt in self.question_types if qt.default]

    def types_for(self, keys: Sequence[str]) -> list[QuestionType]:
        """The question types among `keys`, in the target's own order."""
        wanted = set(keys)
        return [qt for qt in self.question_types if qt.key in wanted]

    def item_type(self, item: dict[str, Any] | BaseModel) -> str | None:
        if self.type_field is None:
            return None
        value = _get(item, self.type_field)
        return value if isinstance(value, str) else None

    def item_text(self, item: dict[str, Any] | BaseModel) -> str:
        values = (_get(item, name) for name in self.text_fields)
        return " — ".join(value for value in values if isinstance(value, str) and value)


def _get(item: dict[str, Any] | BaseModel, name: str) -> Any:
    return item.get(name) if isinstance(item, dict) else getattr(item, name, None)

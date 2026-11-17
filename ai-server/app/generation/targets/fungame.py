"""Fun games: fast single-answer questions for the party-game import."""

from __future__ import annotations

from pydantic import Field, model_validator

from app.generation.prompting import LANGUAGE_RULE
from app.generation.registry import registry
from app.generation.schemas.common import ItemModel, Text, distinct
from app.generation.types import Noun, QuestionType, TargetSpec


class FunGameQuestion(ItemModel):
    text: Text
    options: list[Text] = Field(min_length=2, max_length=6)
    answer: int = Field(ge=0)

    @model_validator(mode="after")
    def _answer_inside_options(self) -> FunGameQuestion:
        if self.answer >= len(self.options):
            raise ValueError("answer points outside options")
        if not distinct(self.options):
            raise ValueError("options repeat")
        return self


QUESTION_TYPES = (
    QuestionType(
        "single_choice",
        "Multiple choice",
        '"single_choice": exactly four options, one correct, plausible distractors, random order.',
        hint="One correct answer",
    ),
    QuestionType("true_false", "True or false", '"true_false": options must be exactly ["True","False"].'),
)

SPEC = registry.register(
    TargetSpec(
        key="fungame",
        noun=Noun("question", "questions"),
        types_label="question styles",
        persona="You write fast-paced quiz game questions. Each question has exactly ONE correct option.",
        question_types=QUESTION_TYPES,
        item_schema=FunGameQuestion,
        general_rules=(
            "Every question must be answerable solely from the input material.",
            f"Keep questions short (under 20 words) so players can read them quickly. {LANGUAGE_RULE}",
        ),
        closing_rules=(
            '"answer" is the 0-based index of the correct option.',
            "Do not repeat questions.",
        ),
        shared_shape='{ "text": "string", "options": ["string", ...], "answer": 0 }',
        # Fun-game items carry no type key: every item is a single-answer question.
        type_field=None,
        text_fields=("text",),
    )
)

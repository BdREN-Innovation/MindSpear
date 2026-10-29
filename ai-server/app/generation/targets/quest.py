"""Quests: slides saved through /quests/{deck}/slides/bulk (backend slide type keys)."""

from __future__ import annotations

from typing import Literal

from pydantic import Field, model_validator

from app.generation.prompting import LANGUAGE_RULE
from app.generation.registry import registry
from app.generation.schemas.common import ItemModel, Text
from app.generation.types import Noun, QuestionType, TargetSpec

QuestSlideType = Literal["poll_single", "poll_multi", "word_cloud", "open_ended", "scales", "ranking", "rating"]

#: Types that need options, and how many at least (backend minimums: polls/ranking 2, scales/rating 1).
MIN_OPTIONS: dict[str, int] = {"poll_single": 2, "poll_multi": 2, "ranking": 2, "scales": 1, "rating": 1}


class QuestSlide(ItemModel):
    title: Text
    type: QuestSlideType
    options: list[str] = Field(default_factory=list, max_length=12)

    @model_validator(mode="before")
    @classmethod
    def _missing_options_are_empty(cls, data: object) -> object:
        if isinstance(data, dict) and data.get("options") is None:
            return {**data, "options": []}
        return data

    @model_validator(mode="after")
    def _enough_options(self) -> QuestSlide:
        usable = sum(1 for option in self.options if option.strip())
        if usable < MIN_OPTIONS.get(self.type, 0):
            raise ValueError("not enough options for this slide type")
        return self


QUESTION_TYPES = (
    QuestionType(
        "poll_single",
        "Multiple choice · one answer",
        '"poll_single": a poll where each person picks one option, 3–5 options. '
        'A yes/no question is a "poll_single" whose options are exactly ["Yes","No"].',
        hint="Includes yes / no questions",
    ),
    QuestionType(
        "poll_multi",
        "Multiple choice · several answers",
        '"poll_multi": a poll where several options may be picked, 3–6 options.',
    ),
    QuestionType(
        "word_cloud",
        "Word cloud",
        '"word_cloud": a prompt answered with one to three words (e.g. "One word that describes …"); "options" must be [].',
    ),
    QuestionType(
        "open_ended",
        "Open ended",
        '"open_ended": an open question answered in a sentence or two; "options" must be [].',
    ),
    QuestionType(
        "scales",
        "Scales",
        '"scales": 2–5 statements the audience rates from "Strongly disagree" to "Strongly agree"; '
        'put the statements in "options".',
        hint="Rate statements",
        default=False,
    ),
    QuestionType(
        "ranking",
        "Ranking",
        '"ranking": 3–6 items for the audience to put in order of priority; put the items in "options".',
        default=False,
    ),
    QuestionType(
        "rating",
        "Rating",
        '"rating": 2–5 items the audience rates with 1–5 stars; put the items in "options".',
        hint="Star-rate items",
        default=False,
    ),
)

SPEC = registry.register(
    TargetSpec(
        key="quest",
        noun=Noun("slide", "slides"),
        types_label="slide types",
        persona=(
            "You design slides for a live audience presentation (polls, word clouds, open questions, scales, ranking "
            "and rating) about a document.\nThese slides gather opinions and reflections; they have NO correct answers."
        ),
        question_types=QUESTION_TYPES,
        item_schema=QuestSlide,
        general_rules=(
            f"Every slide must relate to the input material and invite the audience to think about it. {LANGUAGE_RULE}",
            "Spread items across the allowed slide types.",
        ),
        closing_rules=(
            '"title" is the question or prompt shown to the audience, under 25 words. '
            "Options are short (under 12 words each) and distinct.",
        ),
        shared_shape='{ "title": "string", "type": "{types}", "options": ["string", ...] }',
        type_field="type",
        text_field="title",
    )
)

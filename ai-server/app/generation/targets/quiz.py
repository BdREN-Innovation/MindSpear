"""
Quizzes: scored slides saved through /quizzes/{deck}/slides/bulk. Each
question type has its own shape carrying the correct answer, so the item
schema is a Union told apart by "type".

The models check the shapes and the MEANING of the answer key (one correct
option on a single-answer pick, a right and a wrong one on a multi, distinct
choices, items that name a listed category). A question that fails is
dropped here, where a top-up can replace it, instead of by the frontend
mapper after the fact. They accept more items than the backend allows: the
mapper trims and clamps to the backend option limits, so a question with 9
order items is cut down, not thrown away. The caps here only stop absurd output.
"""

from __future__ import annotations

from typing import Literal

from pydantic import Field, model_validator

from app.generation.prompting import LANGUAGE_RULE
from app.generation.registry import registry
from app.generation.schemas.common import ItemModel, Text, distinct, text_key
from app.generation.types import Noun, QuestionType, TargetSpec

SANE_MAX = 50


class Choice(ItemModel):
    text: Text
    correct: bool


class PickAnswerSingle(ItemModel):
    type: Literal["pick_answer_single"]
    title: Text
    options: list[Choice] = Field(min_length=2, max_length=SANE_MAX)

    @model_validator(mode="after")
    def _exactly_one_correct(self) -> PickAnswerSingle:
        if sum(1 for o in self.options if o.correct) != 1:
            raise ValueError("pick_answer_single needs exactly one correct option")
        if not distinct(o.text for o in self.options):
            raise ValueError("options repeat")
        return self


class PickAnswerMulti(ItemModel):
    type: Literal["pick_answer_multi"]
    title: Text
    options: list[Choice] = Field(min_length=2, max_length=SANE_MAX)

    @model_validator(mode="after")
    def _a_right_and_a_wrong_one(self) -> PickAnswerMulti:
        # All-or-nothing scoring: at least one right and one wrong choice, or the question is trivial.
        correct = sum(1 for o in self.options if o.correct)
        if correct < 1 or correct == len(self.options):
            raise ValueError("pick_answer_multi needs at least one correct and one incorrect option")
        if not distinct(o.text for o in self.options):
            raise ValueError("options repeat")
        return self


class TrueFalse(ItemModel):
    type: Literal["true_false"]
    title: Text
    answer: bool


class ShortAnswer(ItemModel):
    type: Literal["short_answer"]
    title: Text
    accepted_answers: list[Text] = Field(min_length=1, max_length=SANE_MAX)


class CorrectOrder(ItemModel):
    type: Literal["correct_order"]
    title: Text
    #: In the correct order, first = top.
    items: list[Text] = Field(min_length=2, max_length=SANE_MAX)

    @model_validator(mode="after")
    def _distinct_items(self) -> CorrectOrder:
        if not distinct(self.items):
            raise ValueError("items repeat")
        return self


class Pair(ItemModel):
    left: Text
    right: Text


class MatchPairs(ItemModel):
    type: Literal["match_pairs"]
    title: Text
    pairs: list[Pair] = Field(min_length=2, max_length=SANE_MAX)

    @model_validator(mode="after")
    def _one_match_each(self) -> MatchPairs:
        if not distinct(p.left for p in self.pairs) or not distinct(p.right for p in self.pairs):
            raise ValueError("a left or a right repeats")
        return self


class CategoriseItem(ItemModel):
    text: Text
    category: Text


class Categorise(ItemModel):
    type: Literal["categorise"]
    title: Text
    categories: list[Text] = Field(min_length=2, max_length=SANE_MAX)
    #: Every item names one of `categories`.
    items: list[CategoriseItem] = Field(min_length=2, max_length=SANE_MAX)

    @model_validator(mode="after")
    def _items_fill_the_categories(self) -> Categorise:
        if not distinct(self.categories) or not distinct(i.text for i in self.items):
            raise ValueError("categories or items repeat")
        categories = {text_key(c) for c in self.categories}
        used = {text_key(i.category) for i in self.items}
        if not used <= categories:
            raise ValueError("an item names a category that is not listed")
        if used != categories:
            raise ValueError("a category has no items")
        return self


#: A plain Union (JSON Schema anyOf, which every structured-output mode accepts): the
#: "type" literal on each member still makes validation unambiguous.
QuizSlide = PickAnswerSingle | PickAnswerMulti | TrueFalse | ShortAnswer | CorrectOrder | MatchPairs | Categorise


QUESTION_TYPES = (
    QuestionType(
        "pick_answer_single",
        "Pick answer · one correct",
        '"pick_answer_single": exactly 4 options, exactly ONE with "correct": true and the others "correct": false; '
        "plausible distractors, correct option at a random position.",
        shape=(
            '{ "type": "pick_answer_single", "title": "string", "options": [{ "text": "string", "correct": true }, '
            '{ "text": "string", "correct": false }, { "text": "string", "correct": false }, '
            '{ "text": "string", "correct": false }] }'
        ),
    ),
    QuestionType(
        "pick_answer_multi",
        "Pick answer · several correct",
        '"pick_answer_multi": 4–6 options, at least TWO with "correct": true and at least one with "correct": false; '
        'the title says that several answers are correct (e.g. "Select all …"). Players score only when they pick '
        "every correct option and no wrong one.",
        shape=(
            '{ "type": "pick_answer_multi", "title": "string", "options": [{ "text": "string", "correct": true }, '
            '{ "text": "string", "correct": true }, { "text": "string", "correct": false }, '
            '{ "text": "string", "correct": false }] }'
        ),
    ),
    QuestionType(
        "true_false",
        "True / False",
        '"true_false": the title is a statement that is clearly true or clearly false according to the material; '
        '"answer" is true or false. Mix true and false statements.',
        shape='{ "type": "true_false", "title": "string", "answer": true }',
    ),
    QuestionType(
        "short_answer",
        "Short answer",
        '"short_answer": a question whose answer is one to three words; "accepted_answers" lists 1–5 accepted '
        "spellings or synonyms of that one answer, each under 100 characters (matching ignores letter case).",
        shape='{ "type": "short_answer", "title": "string", "accepted_answers": ["string", "string"] }',
        hint="Typed answer, up to 5 accepted spellings",
    ),
    QuestionType(
        "correct_order",
        "Correct order",
        '"correct_order": 3–6 distinct "items" listed in the CORRECT order, first = top (steps of a process, events '
        "by date, values by size …); the title says what to order by.",
        shape='{ "type": "correct_order", "title": "string", "items": ["first", "second", "third", "fourth"] }',
    ),
    QuestionType(
        "match_pairs",
        "Match pairs",
        '"match_pairs": 3–6 "pairs"; each "left" matches exactly one "right" (term ↔ definition, person ↔ '
        "achievement …); all lefts distinct and all rights distinct.",
        shape=(
            '{ "type": "match_pairs", "title": "string", "pairs": [{ "left": "string", "right": "string" }, '
            '{ "left": "string", "right": "string" }, { "left": "string", "right": "string" }] }'
        ),
    ),
    QuestionType(
        "categorise",
        "Categorise",
        '"categorise": 2–4 short "categories" and 4–10 distinct "items"; each item\'s "category" is copied exactly '
        'from "categories", every category gets at least one item, and no item could belong to two categories.',
        shape=(
            '{ "type": "categorise", "title": "string", "categories": ["string", "string"], "items": '
            '[{ "text": "string", "category": "string" }, { "text": "string", "category": "string" }, '
            '{ "text": "string", "category": "string" }, { "text": "string", "category": "string" }] }'
        ),
    ),
)

SPEC = registry.register(
    TargetSpec(
        key="quiz",
        noun=Noun("question", "questions"),
        types_label="question types",
        persona=(
            "You are QuizGen AI, an expert question-writer for a live, slide-based quiz game in which players score "
            "points for correct answers."
        ),
        question_types=QUESTION_TYPES,
        item_schema=QuizSlide,
        general_rules=(
            "Every question must be answerable solely from the input material, and every answer marked correct must "
            "be unambiguously correct according to it.",
            f"Use clear language suited to the audience and difficulty. {LANGUAGE_RULE}",
            "Use only the allowed question types and spread the questions across them.",
            '"title" is the question shown on the big screen, under 25 words. Options, answers and items are short '
            "(under 10 words each) and distinct.",
            "Do not repeat questions.",
        ),
        type_field="type",
        text_field="title",
    )
)

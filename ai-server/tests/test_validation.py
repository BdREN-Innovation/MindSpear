import pytest
from pydantic import ValidationError

from app.generation.schemas.request import GenerateRequest
from app.generation.targets import registry
from app.generation.validation import raw_items, validate_items
from app.llm.base import LLMOutput
from tests.conftest import make_request

QUIZ_ITEMS = [
    {
        "type": "pick_answer_single",
        "title": "Where does photosynthesis take place?",
        "options": [
            {"text": "Chloroplasts", "correct": True},
            {"text": "Mitochondria", "correct": False},
            {"text": "Nucleus", "correct": False},
            {"text": "Ribosomes", "correct": False},
        ],
    },
    # Two correct options on a single-answer pick: rejected.
    {
        "type": "pick_answer_single",
        "title": "Which gas is produced?",
        "options": [{"text": "Oxygen", "correct": True}, {"text": "O2", "correct": True}],
    },
    # Everything correct on a multi: rejected.
    {
        "type": "pick_answer_multi",
        "title": "Select all inputs",
        "options": [{"text": "Water", "correct": True}, {"text": "CO2", "correct": True}],
    },
    {"type": "true_false", "title": "Leaves look green because chlorophyll reflects green light.", "answer": True},
    # A repeat (case and spacing differ): rejected.
    {"type": "true_false", "title": "  leaves look GREEN because chlorophyll reflects green light. ", "answer": True},
    # Type the user did not ask for: rejected.
    {
        "type": "categorise",
        "title": "Sort these",
        "categories": ["a", "b"],
        "items": [{"text": "x", "category": "a"}, {"text": "y", "category": "b"}],
    },
    {"type": "short_answer", "title": "Name the pigment that absorbs light.", "accepted_answers": ["chlorophyll"]},
    {"type": "match_pairs", "title": "Match", "pairs": [{"left": "a", "right": "b"}]},  # too few pairs
    "not even an object",
]


def test_quiz_keeps_valid_requested_unique_items():
    spec = registry.get("quiz")
    result = validate_items(
        spec,
        QUIZ_ITEMS,
        requested_types=["pick_answer_single", "pick_answer_multi", "true_false", "short_answer", "match_pairs"],
    )

    assert [item.type for item in result.items] == ["pick_answer_single", "true_false", "short_answer"]
    assert result.rejected == 6
    assert "type 'categorise' was not requested" in result.reasons


def test_quiz_rejects_answer_keys_the_mapper_would_have_to_break():
    spec = registry.get("quiz")
    items = [
        # Same option twice (case differs): which "oxygen" is right?
        {
            "type": "pick_answer_single",
            "title": "Which gas is produced?",
            "options": [{"text": "Oxygen", "correct": True}, {"text": "oxygen", "correct": False}],
        },
        {"type": "correct_order", "title": "Order", "items": ["light", "water", "Light"]},
        {
            "type": "match_pairs",
            "title": "Match",
            "pairs": [{"left": "a", "right": "x"}, {"left": "b", "right": "x"}],
        },
        # An item in a category that is not listed.
        {
            "type": "categorise",
            "title": "Sort",
            "categories": ["Input", "Output"],
            "items": [{"text": "Water", "category": "Input"}, {"text": "Oxygen", "category": "By-product"}],
        },
        # A listed category with no item.
        {
            "type": "categorise",
            "title": "Sort again",
            "categories": ["Input", "Output", "Neither"],
            "items": [{"text": "Water", "category": "Input"}, {"text": "Oxygen", "category": "Output"}],
        },
        # Category names match ignoring case and spacing: kept.
        {
            "type": "categorise",
            "title": "Sort once more",
            "categories": ["Input", "Output"],
            "items": [{"text": "Water", "category": " input"}, {"text": "Oxygen", "category": "OUTPUT"}],
        },
    ]
    result = validate_items(
        spec, items, requested_types=["pick_answer_single", "correct_order", "match_pairs", "categorise"]
    )

    assert [item.title for item in result.items] == ["Sort once more"]
    assert result.rejected == 5


def test_quiz_blanks_need_a_bracketed_answer_and_drag_drop_a_wrong_word():
    spec = registry.get("quiz")
    items = [
        {"type": "fill_blanks", "title": "Fill in the blanks", "sentence": "Plants make food by [photosynthesis]."},
        {"type": "fill_blanks", "title": "No blank", "sentence": "Plants make food []."},
        {"type": "fill_blanks", "title": "Too long", "sentence": "[word] " + "x" * 600},
        {
            "type": "drag_drop",
            "title": "Drag the words",
            "sentence": "Water [boils] at 100 °C and [freezes] at 0 °C.",
            "distractors": ["melts", "Boils"],
        },
        # Its only "wrong" word is an answer: the bank would hold nothing to choose between.
        {"type": "drag_drop", "title": "Drag again", "sentence": "Water [boils].", "distractors": [" boils"]},
        {"type": "drag_drop", "title": "No bank", "sentence": "Water [boils]."},
    ]
    result = validate_items(spec, items, requested_types=["fill_blanks", "drag_drop"])

    assert [item.title for item in result.items] == ["Fill in the blanks", "Drag the words"]
    assert result.rejected == 4


def test_quiz_blanks_with_the_same_title_are_told_apart_by_their_sentence():
    spec = registry.get("quiz")
    items = [
        {"type": "fill_blanks", "title": "Fill in the blanks", "sentence": "Plants make [glucose]."},
        {"type": "fill_blanks", "title": "Fill in the blanks", "sentence": "Leaves hold [chlorophyll]."},
        {"type": "fill_blanks", "title": "fill in the blanks ", "sentence": " plants make [glucose]."},
    ]
    result = validate_items(spec, items, requested_types=["fill_blanks"])

    assert [item.sentence for item in result.items] == ["Plants make [glucose].", "Leaves hold [chlorophyll]."]
    assert result.reasons == ["repeated item"]


def test_quest_matrix_needs_both_axes_and_points_allocation_items():
    spec = registry.get("quest")
    axes = {"x_axis": {"low": "Not urgent", "high": "Urgent"}, "y_axis": {"low": "Minor", "high": "Important"}}
    items = [
        {"title": "Where does this idea stand?", "type": "matrix_2x2", **axes},
        {"title": "Only one axis", "type": "matrix_2x2", "x_axis": axes["x_axis"]},
        {"title": "Share 100 points", "type": "points_allocation", "options": ["Cost", "Speed", "Quality"]},
        {"title": "Too few to share", "type": "points_allocation", "options": ["Cost"]},
    ]
    result = validate_items(spec, items, requested_types=["matrix_2x2", "points_allocation"])

    assert [item.title for item in result.items] == ["Where does this idea stand?", "Share 100 points"]
    assert result.items[0].y_axis.high == "Important"


def test_fungame_rejects_repeated_options():
    spec = registry.get("fungame")
    result = validate_items(spec, [{"text": "Q?", "options": ["Yes", "yes"], "answer": 0}], requested_types=[])
    assert result.items == []


def test_seen_keys_carry_over_between_calls():
    spec = registry.get("fungame")
    seen: set[str] = set()
    first = validate_items(
        spec, [{"text": "Q1?", "options": ["a", "b"], "answer": 0}], requested_types=[], seen_keys=seen
    )
    second = validate_items(
        spec,
        [{"text": "q1?", "options": ["a", "b"], "answer": 1}, {"text": "Q2?", "options": ["a", "b"], "answer": 1}],
        requested_types=[],
        seen_keys=seen,
    )

    assert len(first.items) == 1
    assert [item.text for item in second.items] == ["Q2?"]
    assert second.rejected == 1


def test_quest_option_minimums_and_missing_options():
    spec = registry.get("quest")
    items = [
        {"title": "One word for this chapter", "type": "word_cloud"},  # options missing: fine for open prompts
        {"title": "Pick one", "type": "poll_single", "options": ["only one"]},  # below the minimum
        {"title": "Rate", "type": "scales", "options": ["Statement"]},
    ]
    result = validate_items(spec, items, requested_types=["word_cloud", "poll_single", "scales"])
    assert [item.type for item in result.items] == ["word_cloud", "scales"]
    assert result.items[0].options == []


def test_raw_items_reads_fenced_json_and_bare_lists():
    assert raw_items(LLMOutput({"questions": [{"a": 1}]}, "")) == [{"a": 1}]
    assert raw_items(LLMOutput(None, '```json\n{"questions": [{"a": 1}]}\n```')) == [{"a": 1}]
    assert raw_items(LLMOutput(None, '[{"a": 1}]')) == [{"a": 1}]
    assert raw_items(LLMOutput(None, "not json")) == []
    assert raw_items(LLMOutput(None, '{"other": []}')) == []


def test_request_filters_types_to_the_target_and_rejects_unknown_target():
    req = make_request("fungame", questionTypes=["true_false", "pick_answer_single", "true_false", "single_choice"])
    assert req.question_types == ["true_false", "single_choice"]

    with pytest.raises(ValidationError, match="Choose at least one question type"):
        make_request("fungame", questionTypes=["pick_answer_single"])
    with pytest.raises(ValidationError, match="Unknown target"):
        make_request("survey")


def test_request_limits():
    req = make_request("quiz", questionCount=5)
    with pytest.raises(ValueError, match="between 1 and 3"):
        req.limited(max_questions=3, max_text_chars=1000, min_text_chars=10)
    with pytest.raises(ValueError, match="enough text"):
        req.limited(max_questions=30, max_text_chars=1000, min_text_chars=10_000)
    cut = req.limited(max_questions=30, max_text_chars=50, min_text_chars=10)
    assert len(cut.text_data) == 50


def test_request_accepts_snake_case_too():
    req = GenerateRequest.model_validate(
        {
            "target": "fungame",
            "text_data": "x" * 50,
            "topic": "t",
            "question_count": 1,
            "question_types": ["single_choice"],
        }
    )
    assert req.question_count == 1

from app.generation.prompting import PromptBuilder
from app.generation.targets import registry
from tests.conftest import MATERIAL, make_request


def test_prompt_lists_only_the_requested_types():
    req = make_request("quiz", questionTypes=["true_false", "match_pairs"])
    prompt = PromptBuilder(registry.get("quiz")).build(req)

    assert MATERIAL in prompt
    assert '"true_false": the title is a statement' in prompt
    assert '"match_pairs": 3–6 "pairs"' in prompt
    assert "categorise" not in prompt
    assert 'Allowed question types: ["true_false", "match_pairs"]' in prompt
    assert "Total items: 3 (generate exactly this many)" in prompt
    # Two shapes, so the schema says every item is one of them.
    assert "exactly one of these shapes" in prompt


def test_shared_shape_names_the_allowed_types():
    req = make_request("quest", questionTypes=["poll_single", "word_cloud"])
    prompt = PromptBuilder(registry.get("quest")).build(req)

    assert '"type": "poll_single | word_cloud"' in prompt
    assert "exactly one of these shapes" not in prompt
    assert '"scales"' not in prompt.split("OUTPUT SCHEMA")[1]


def test_numbering_runs_general_then_type_then_closing_rules():
    req = make_request("fungame", questionTypes=["single_choice"])
    prompt = PromptBuilder(registry.get("fungame")).build(req)
    rules = prompt.split("CONSTRUCTION RULES\n")[1].split("\n\nOUTPUT SCHEMA")[0].splitlines()

    assert rules[0].startswith("1. Every question must be answerable")
    assert rules[2].startswith('3. "single_choice": exactly four options')
    assert rules[-1].startswith("5. Do not repeat questions")


def test_topup_prompt_asks_for_the_shortfall_and_lists_written_items():
    req = make_request("fungame")
    prompt = PromptBuilder(registry.get("fungame")).build(req, count=2, exclude=["What is chlorophyll?"])

    assert "Total items: 2 (generate exactly this many)" in prompt
    assert "ALREADY WRITTEN" in prompt
    assert "- What is chlorophyll?" in prompt
    assert prompt.index("ALREADY WRITTEN") < prompt.index("OUTPUT SCHEMA")

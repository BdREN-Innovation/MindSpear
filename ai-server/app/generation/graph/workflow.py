"""
The generation workflow as a LangGraph state machine:

    build_prompt → call_llm → validate ─┬─ nothing usable yet, calls left  → call_llm (retry)
                                        ├─ short of the count, top-ups left → topup → call_llm
                                        └─ otherwise                        → END

A retry repeats the same prompt. A top-up asks only for the missing items
and lists the ones already written, so the second answer adds to the first;
when a top-up call fails, the items already written are returned.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Literal

from langgraph.graph import END, START, StateGraph
from langgraph.graph.state import CompiledStateGraph

from app.errors import UpstreamError
from app.generation.graph.state import GenerationState
from app.generation.prompting import SYSTEM_MESSAGE, PromptBuilder
from app.generation.registry import TargetRegistry
from app.generation.validation import envelope_model, raw_items, validate_items
from app.llm.base import StructuredLLM

log = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class GenerationPolicy:
    #: LLM calls made before giving up when nothing usable has come back.
    max_attempts: int = 2
    #: Extra calls to fill the gap when fewer items than requested are usable.
    max_topups: int = 1


class GenerationGraph:
    """Builds the graph once; `compiled` is safe to share between requests."""

    def __init__(self, llm: StructuredLLM, registry: TargetRegistry, policy: GenerationPolicy) -> None:
        self._llm = llm
        self._registry = registry
        self._policy = policy
        self.compiled: CompiledStateGraph = self._build()

    # --- nodes -----------------------------------------------------------------

    def _builder(self, state: GenerationState) -> PromptBuilder:
        return PromptBuilder(self._registry.get(state["request"].target))

    def build_prompt(self, state: GenerationState) -> GenerationState:
        return {
            "prompt": self._builder(state).build(state["request"]),
            "items": [],
            "seen_keys": set(),
            "llm_calls": 0,
            "topups": 0,
            "rejected": 0,
            "model": self._llm.model_name,
        }

    async def call_llm(self, state: GenerationState) -> GenerationState:
        spec = self._registry.get(state["request"].target)
        try:
            output = await self._llm.generate(SYSTEM_MESSAGE, state["prompt"], envelope_model(spec))
        except UpstreamError:
            if not state["items"]:
                raise
            # A top-up failed: return what the earlier answer gave rather than nothing.
            log.warning("%s: top-up call failed, returning %d item(s)", spec.key, len(state["items"]))
            return {"candidates": [], "llm_calls": state["llm_calls"] + 1, "topups": self._policy.max_topups}
        return {"candidates": raw_items(output), "llm_calls": state["llm_calls"] + 1}

    def validate(self, state: GenerationState) -> GenerationState:
        spec = self._registry.get(state["request"].target)
        seen = set(state["seen_keys"])
        result = validate_items(
            spec, state.get("candidates", []), requested_types=state["request"].question_types, seen_keys=seen
        )
        if result.rejected:
            log.info("%s: rejected %d item(s): %s", spec.key, result.rejected, "; ".join(result.reasons[:5]))
        return {
            "items": [*state["items"], *result.items],
            "seen_keys": seen,
            "rejected": state["rejected"] + result.rejected,
            "candidates": [],
        }

    def topup(self, state: GenerationState) -> GenerationState:
        req = state["request"]
        spec = self._registry.get(req.target)
        shortfall = req.question_count - len(state["items"])
        written = [spec.item_text(item) for item in state["items"]]
        return {
            "prompt": self._builder(state).build(req, count=shortfall, exclude=written),
            "topups": state["topups"] + 1,
        }

    # --- routing ---------------------------------------------------------------

    def after_validate(self, state: GenerationState) -> Literal["call_llm", "topup", "__end__"]:
        have = len(state["items"])
        want = state["request"].question_count
        if have == 0:
            return "call_llm" if state["llm_calls"] < self._policy.max_attempts else END
        if have < want and state["topups"] < self._policy.max_topups:
            return "topup"
        return END

    # --- assembly --------------------------------------------------------------

    def _build(self) -> CompiledStateGraph:
        graph = StateGraph(GenerationState)
        graph.add_node("build_prompt", self.build_prompt)
        graph.add_node("call_llm", self.call_llm)
        graph.add_node("validate", self.validate)
        graph.add_node("topup", self.topup)
        graph.add_edge(START, "build_prompt")
        graph.add_edge("build_prompt", "call_llm")
        graph.add_edge("call_llm", "validate")
        graph.add_conditional_edges(
            "validate", self.after_validate, {"call_llm": "call_llm", "topup": "topup", END: END}
        )
        graph.add_edge("topup", "call_llm")
        return graph.compile()

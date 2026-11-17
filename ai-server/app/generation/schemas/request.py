"""What the frontend sends. Field names stay camelCase on the wire."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.generation.targets import registry


class GenerateRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, str_strip_whitespace=True)

    target: str
    text_data: str = Field(alias="textData", description="Text of the selected pages.")
    topic: str = Field(min_length=1, max_length=200)
    question_count: int = Field(alias="questionCount", ge=1)
    question_types: list[str] = Field(alias="questionTypes", min_length=1)
    difficulty: str = Field(default="Medium", max_length=40)
    audience_level: str = Field(default="Generic", alias="audienceLevel", max_length=40)
    focus_area: str = Field(default="", alias="focusArea", max_length=300)

    @field_validator("target")
    @classmethod
    def _known_target(cls, value: str) -> str:
        if value not in registry:
            raise ValueError(f"Unknown target '{value}'. Use one of: {', '.join(registry.keys())}.")
        return value

    @model_validator(mode="after")
    def _only_the_targets_types(self) -> GenerateRequest:
        """Keeps the type keys the target knows, once each, in the order given."""
        known = set(registry.get(self.target).type_keys)
        kept: list[str] = []
        for key in self.question_types:
            if key in known and key not in kept:
                kept.append(key)
        if not kept:
            raise ValueError("Choose at least one question type.")
        self.question_types = kept
        return self

    def limited(self, *, max_questions: int, max_text_chars: int, min_text_chars: int) -> GenerateRequest:
        """A copy that respects the server's size limits (raises when the text is too short)."""
        if len(self.text_data) < min_text_chars:
            raise ValueError("The selected pages don't contain enough text to write questions from.")
        if self.question_count > max_questions:
            raise ValueError(f"Choose between 1 and {max_questions} items.")
        return self.model_copy(update={"text_data": self.text_data[:max_text_chars]})

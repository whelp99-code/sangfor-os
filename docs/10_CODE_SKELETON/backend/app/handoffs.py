from __future__ import annotations

from enum import StrEnum
from pydantic import BaseModel, Field
from .color_agents import ColorKey


class HandoffType(StrEnum):
    REVIEW = "review"
    DECISION = "decision"
    CLARIFICATION = "clarification"
    RISK_CHECK = "risk_check"
    UX_CHECK = "ux_check"
    EVIDENCE_CHECK = "evidence_check"


class HandoffPriority(StrEnum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class HandoffCreate(BaseModel):
    project_id: str
    workflow_run_id: str | None = None
    linked_approval_id: str | None = None
    from_color: ColorKey
    to_color: ColorKey
    type: HandoffType
    priority: HandoffPriority = HandoffPriority.MEDIUM
    context: str = Field(min_length=10)
    decision_needed: str = Field(min_length=10)
    constraints: list[str] = Field(default_factory=list)
    suggested_answer: str | None = None
    required_output: list[str] = Field(default_factory=list)
    linked_artifact_ids: list[str] = Field(default_factory=list)
    due_at: str | None = None


class HandoffDecision(BaseModel):
    decision: str = Field(pattern="^(accepted|changes_requested|resolved|rejected|escalated)$")
    rationale: str = Field(min_length=5)
    output: dict = Field(default_factory=dict)


def validate_handoff(payload: HandoffCreate) -> list[str]:
    errors: list[str] = []
    if payload.from_color == payload.to_color:
        errors.append("from_color and to_color must be different")
    if payload.priority in {HandoffPriority.HIGH, HandoffPriority.CRITICAL} and not payload.linked_artifact_ids:
        errors.append("high/critical handoff requires at least one linked artifact")
    if not payload.required_output:
        errors.append("required_output must not be empty")
    if not payload.suggested_answer:
        errors.append("suggested_answer is recommended to prevent vague handoff")
    return errors

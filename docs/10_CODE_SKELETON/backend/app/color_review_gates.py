from __future__ import annotations

from pydantic import BaseModel
from .color_agents import ColorKey


class ColorReviewStatus(BaseModel):
    color: ColorKey
    status: str
    rationale: str | None = None


class ColorGateCheckInput(BaseModel):
    required_colors: list[ColorKey]
    reviews: list[ColorReviewStatus]


class ColorGateCheckResult(BaseModel):
    passed: bool
    missing_colors: list[ColorKey]
    failed_colors: list[ColorKey]


def check_color_gate(payload: ColorGateCheckInput) -> ColorGateCheckResult:
    review_by_color = {review.color: review.status for review in payload.reviews}
    missing = [color for color in payload.required_colors if color not in review_by_color]
    failed = [color for color, status in review_by_color.items() if color in payload.required_colors and status == "failed"]
    return ColorGateCheckResult(passed=not missing and not failed, missing_colors=missing, failed_colors=failed)

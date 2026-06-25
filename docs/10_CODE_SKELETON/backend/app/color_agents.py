from __future__ import annotations

from enum import StrEnum
from typing import Any
from pydantic import BaseModel, Field


class ColorKey(StrEnum):
    BLUE = "blue"
    RED = "red"
    ORANGE = "orange"
    GRAY = "gray"
    TEAL = "teal"
    PURPLE = "purple"


class ColorAgentProfile(BaseModel):
    color_key: ColorKey
    display_name: str
    responsibility: str
    handoff_triggers: list[str] = Field(default_factory=list)
    output_contract: list[str] = Field(default_factory=list)


class ColorRoutingInput(BaseModel):
    artifact_type: str | None = None
    risk_level: str = "medium"
    customer_facing: bool = False
    contains_restricted_data: bool = False
    commercially_sensitive: bool = False
    ui_impact: bool = False
    technical_impact: bool = False


class ColorRoutingResult(BaseModel):
    required_colors: list[ColorKey]
    optional_colors: list[ColorKey] = Field(default_factory=list)
    requires_human_approval: bool = False
    rationale: list[str] = Field(default_factory=list)


def route_color_agents(payload: ColorRoutingInput) -> ColorRoutingResult:
    required: set[ColorKey] = set()
    optional: set[ColorKey] = set()
    rationale: list[str] = []
    human = False

    if payload.technical_impact:
        required.add(ColorKey.BLUE)
        rationale.append("technical_impact requires Blue review")

    if payload.contains_restricted_data:
        required.update({ColorKey.RED, ColorKey.GRAY})
        human = True
        rationale.append("restricted data requires Red + Gray and human approval")

    if payload.commercially_sensitive or payload.artifact_type in {"quote", "discount_request"}:
        required.update({ColorKey.ORANGE, ColorKey.RED, ColorKey.GRAY})
        human = True
        rationale.append("commercial sensitivity requires Orange + Red + Gray")

    if payload.customer_facing:
        required.update({ColorKey.ORANGE, ColorKey.GRAY})
        optional.add(ColorKey.TEAL)
        human = True
        rationale.append("customer-facing artifact requires Orange + Gray, Teal optional")

    if payload.ui_impact:
        required.add(ColorKey.TEAL)
        rationale.append("ui_impact requires Teal review")

    if payload.artifact_type == "poc_plan":
        required.update({ColorKey.BLUE, ColorKey.RED, ColorKey.ORANGE})
        human = True
        rationale.append("PoC plan requires Blue + Red + Orange")

    if payload.artifact_type == "rca":
        required.update({ColorKey.BLUE, ColorKey.RED, ColorKey.GRAY})
        human = True
        rationale.append("RCA requires Blue + Red + Gray")

    if not required:
        if payload.risk_level == "low":
            required.add(ColorKey.ORANGE)
            rationale.append("low risk default route is Orange")
        elif payload.risk_level == "medium":
            required.update({ColorKey.BLUE, ColorKey.GRAY})
            rationale.append("medium risk default route is Blue + Gray")
        else:
            required.update({ColorKey.BLUE, ColorKey.RED, ColorKey.ORANGE, ColorKey.GRAY})
            human = payload.risk_level == "critical"
            rationale.append("high/critical default route uses Blue + Red + Orange + Gray")

    optional = optional - required
    return ColorRoutingResult(
        required_colors=sorted(required),
        optional_colors=sorted(optional),
        requires_human_approval=human,
        rationale=rationale,
    )

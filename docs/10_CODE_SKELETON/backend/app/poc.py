from __future__ import annotations

from pydantic import BaseModel, Field


class POCProjectCreate(BaseModel):
    opportunity_id: str
    success_criteria: list[str] = Field(default_factory=list)
    test_scenarios: list[str] = Field(default_factory=list)
    customer_approver: str | None = None
    start_date: str | None = None
    end_date: str | None = None


class POCResourceCreate(BaseModel):
    poc_project_id: str
    resource_type: str
    resource_name: str
    reservation_start: str | None = None
    reservation_end: str | None = None

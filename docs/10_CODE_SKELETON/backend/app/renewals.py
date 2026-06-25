from __future__ import annotations

from datetime import date, timedelta
from pydantic import BaseModel, Field


class RenewalGenerateRequest(BaseModel):
    days_ahead: int = Field(default=90, ge=1, le=365)


def renewal_due_window(today: date, days_ahead: int) -> tuple[date, date]:
    return today, today + timedelta(days=days_ahead)

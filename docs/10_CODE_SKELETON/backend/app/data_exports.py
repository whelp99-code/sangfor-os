from __future__ import annotations

from pydantic import BaseModel


class ArtifactExportRequest(BaseModel):
    export_format: str
    reason: str


class ArtifactAccessEventCreate(BaseModel):
    access_type: str
    reason: str | None = None


def watermark_text(user_email_or_id: str, company_name: str, request_id: str, timestamp: str) -> str:
    return f"{company_name} | {user_email_or_id} | {request_id} | {timestamp}"

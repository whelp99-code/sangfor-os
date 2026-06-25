from __future__ import annotations

from pydantic import BaseModel


class EngineerCertificationCreate(BaseModel):
    user_id: str
    vendor_key: str = "sangfor"
    certification_key: str
    certification_name: str
    product_family_id: str | None = None
    issued_at: str | None = None
    expires_at: str | None = None


class SkillMatrixUpdate(BaseModel):
    user_id: str
    product_family_id: str
    skill_level: str
    can_presales: bool = False
    can_delivery: bool = False
    can_support: bool = False

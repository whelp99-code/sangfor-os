from __future__ import annotations

from pydantic import BaseModel, Field


class VendorRequestCreate(BaseModel):
    request_type: str
    vendor_key: str = "sangfor"
    opportunity_id: str | None = None
    quote_id: str | None = None
    payload: dict = Field(default_factory=dict)


class DiscountRequestCreate(BaseModel):
    requested_discount_percent: float = Field(ge=0, le=100)
    reason: str
    vendor_required: bool = False


class DemoLicenseRequestCreate(BaseModel):
    product_sku_id: str
    customer_id: str
    requested_start_date: str | None = None
    requested_end_date: str | None = None
    reason: str


def validate_vendor_request(payload: VendorRequestCreate) -> None:
    allowed = {
        "deal_registration", "special_discount", "demo_license", "nfr_asset",
        "technical_escalation", "partner_portal_request", "training_request"
    }
    if payload.request_type not in allowed:
        raise ValueError(f"Unsupported vendor request type: {payload.request_type}")

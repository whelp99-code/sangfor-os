from __future__ import annotations

from pydantic import BaseModel


class SubscriptionIn(BaseModel):
    start_date: str
    end_date: str


class CustomerAssetCreate(BaseModel):
    customer_id: str
    product_family_id: str | None = None
    product_sku_id: str | None = None
    delivery_project_id: str | None = None
    asset_name: str
    serial_number: str | None = None
    activation_reference: str | None = None
    installed_at: str | None = None
    subscription: SubscriptionIn | None = None


class AssetLicenseCreate(BaseModel):
    customer_asset_id: str
    product_sku_id: str | None = None
    license_key_ref: str | None = None
    license_metric: str | None = None
    licensed_quantity: float | None = None
    activated_at: str | None = None
    expires_at: str | None = None

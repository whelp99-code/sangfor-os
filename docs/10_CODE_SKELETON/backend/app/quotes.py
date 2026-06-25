from decimal import Decimal
from pydantic import BaseModel, Field

class QuoteLineItemIn(BaseModel):
    line_type: str
    product_sku_id: str | None = None
    description: str
    quantity: Decimal = Field(gt=0)
    unit_price: Decimal = Field(ge=0)
    unit_cost: Decimal = Field(ge=0)
    discount_percent: Decimal = Field(default=0, ge=0, le=100)

def calculate_quote(lines: list[QuoteLineItemIn]) -> dict:
    revenue = Decimal("0")
    cost = Decimal("0")

    for item in lines:
        line_revenue = item.quantity * item.unit_price * (Decimal("1") - item.discount_percent / Decimal("100"))
        line_cost = item.quantity * item.unit_cost
        revenue += line_revenue
        cost += line_cost

    margin_amount = revenue - cost
    margin_percent = Decimal("0") if revenue == 0 else (margin_amount / revenue) * Decimal("100")

    return {
        "revenue": str(revenue.quantize(Decimal("0.01"))),
        "cost": str(cost.quantize(Decimal("0.01"))),
        "margin_amount": str(margin_amount.quantize(Decimal("0.01"))),
        "margin_percent": str(margin_percent.quantize(Decimal("0.01"))),
        "requires_commercial_approval": margin_percent < Decimal("20")
    }

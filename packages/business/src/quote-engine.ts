import { evaluateCommercialApproval, type CommercialApprovalDecision } from "./commercial-approval";

export interface QuoteLineItem {
  productName: string
  quantity: number
  unitPrice: number
  costPrice: number
  discountPct: number
}

export interface QuoteResult {
  lineItems: Array<QuoteLineItem & {
    revenue: number
    cost: number
    marginAmount: number
    marginPct: number
  }>
  totalRevenue: number
  totalCost: number
  totalMargin: number
  overallMarginPct: number
  requiresCommercialApproval: boolean
  commercialGateReason?: string
  approvalDecision: CommercialApprovalDecision
}

const MIN_MARGIN_PCT = 15
const MAX_DISCOUNT_PCT = 25

function assertPercentage(value: number, errorCode: string) {
  if (!Number.isFinite(value) || value < 0 || value > 100) throw new Error(errorCode)
}

function validateLineItem(item: QuoteLineItem) {
  if (!Number.isFinite(item.quantity) || item.quantity <= 0) throw new Error("quote_quantity_must_be_positive")
  if (!Number.isFinite(item.unitPrice) || item.unitPrice < 0) throw new Error("quote_price_must_be_non_negative")
  if (!Number.isFinite(item.costPrice) || item.costPrice < 0) throw new Error("quote_price_must_be_non_negative")
  assertPercentage(item.discountPct, "quote_discount_must_be_percentage")
}

export function calculateQuote(lineItems: QuoteLineItem[]): QuoteResult {
  if (lineItems.length === 0) throw new Error("quote_line_items_required")
  lineItems.forEach(validateLineItem)

  const items = lineItems.map(item => {
    const revenue = item.quantity * item.unitPrice * (1 - item.discountPct / 100)
    const cost = item.quantity * item.costPrice
    const marginAmount = revenue - cost
    const marginPct = revenue > 0 ? (marginAmount / revenue) * 100 : 0
    return { ...item, revenue, cost, marginAmount, marginPct }
  })

  const totalRevenue = items.reduce((s, i) => s + i.revenue, 0)
  const totalCost = items.reduce((s, i) => s + i.cost, 0)
  const totalMargin = totalRevenue - totalCost
  const overallMarginPct = totalRevenue > 0 ? (totalMargin / totalRevenue) * 100 : 0
  const maxDiscount = Math.max(...lineItems.map(i => i.discountPct))

  const approvalDecision = totalRevenue > 0
    ? evaluateCommercialApproval({
        revenue: totalRevenue,
        cost: totalCost,
        discountPercent: maxDiscount,
        action: "view-dashboard",
        lowMarginThresholdPercent: MIN_MARGIN_PCT,
        highDiscountThresholdPercent: MAX_DISCOUNT_PCT,
      })
    : {
        revenue: totalRevenue,
        cost: totalCost,
        grossMargin: totalMargin,
        grossMarginPercent: 0,
        decision: "requires_approval" as const,
        blocked: true,
        reasons: ["low_margin" as const],
      }
  if (maxDiscount === MAX_DISCOUNT_PCT) {
    approvalDecision.reasons = approvalDecision.reasons.filter(reason => reason !== "high_discount")
    approvalDecision.decision = approvalDecision.reasons.length > 0 ? "requires_approval" : "allowed"
    approvalDecision.blocked = approvalDecision.reasons.length > 0
  }

  let requiresCommercialApproval = approvalDecision.reasons.some(reason => reason === "low_margin" || reason === "high_discount")
  let commercialGateReason: string | undefined

  if (overallMarginPct < MIN_MARGIN_PCT) {
    commercialGateReason = `Overall margin ${overallMarginPct.toFixed(1)}% is below ${MIN_MARGIN_PCT}% threshold`
  }

  if (maxDiscount > MAX_DISCOUNT_PCT) {
    requiresCommercialApproval = true
    const reason = `Discount ${maxDiscount}% exceeds ${MAX_DISCOUNT_PCT}% maximum`
    commercialGateReason = commercialGateReason ? `${commercialGateReason}; ${reason}` : reason
  }

  return { lineItems: items, totalRevenue, totalCost, totalMargin, overallMarginPct, requiresCommercialApproval, commercialGateReason, approvalDecision }
}

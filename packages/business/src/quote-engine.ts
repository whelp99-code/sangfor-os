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
}

const MIN_MARGIN_PCT = 15
const MAX_DISCOUNT_PCT = 25

export function calculateQuote(lineItems: QuoteLineItem[]): QuoteResult {
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

  let requiresCommercialApproval = false
  let commercialGateReason: string | undefined

  if (overallMarginPct < MIN_MARGIN_PCT) {
    requiresCommercialApproval = true
    commercialGateReason = `Overall margin ${overallMarginPct.toFixed(1)}% is below ${MIN_MARGIN_PCT}% threshold`
  }

  const maxDiscount = Math.max(...lineItems.map(i => i.discountPct))
  if (maxDiscount > MAX_DISCOUNT_PCT) {
    requiresCommercialApproval = true
    const reason = `Discount ${maxDiscount}% exceeds ${MAX_DISCOUNT_PCT}% maximum`
    commercialGateReason = commercialGateReason ? `${commercialGateReason}; ${reason}` : reason
  }

  return { lineItems: items, totalRevenue, totalCost, totalMargin, overallMarginPct, requiresCommercialApproval, commercialGateReason }
}

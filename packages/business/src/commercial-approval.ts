import { requiresApprovalForAction } from "@sangfor/shared/modes";

export type CommercialApprovalInput = {
  revenue: number;
  cost: number;
  discountPercent: number;
  action: string;
  lowMarginThresholdPercent?: number;
  highDiscountThresholdPercent?: number;
};

export type CommercialMarginResult = {
  revenue: number;
  cost: number;
  grossMargin: number;
  grossMarginPercent: number;
};

export type CommercialApprovalReason = "low_margin" | "high_discount" | "unsafe_action";

export type CommercialApprovalDecision = CommercialMarginResult & {
  decision: "allowed" | "requires_approval";
  blocked: boolean;
  reasons: CommercialApprovalReason[];
};

function roundPercent(value: number) {
  return Math.round(value * 100) / 100;
}

function assertPercentage(value: number, errorCode: string) {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error(errorCode);
  }
}

export function calculateGrossMargin(input: CommercialApprovalInput): CommercialMarginResult {
  if (!Number.isFinite(input.revenue) || input.revenue <= 0) {
    throw new Error("commercial_revenue_must_be_positive");
  }
  if (!Number.isFinite(input.cost) || input.cost < 0) {
    throw new Error("commercial_cost_must_be_non_negative");
  }
  const grossMargin = input.revenue - input.cost;
  return {
    revenue: input.revenue,
    cost: input.cost,
    grossMargin,
    grossMarginPercent: roundPercent((grossMargin / input.revenue) * 100),
  };
}

export function evaluateCommercialApproval(input: CommercialApprovalInput): CommercialApprovalDecision {
  const margin = calculateGrossMargin(input);
  const lowMarginThreshold = input.lowMarginThresholdPercent ?? 20;
  const highDiscountThreshold = input.highDiscountThresholdPercent ?? 20;
  assertPercentage(input.discountPercent, "commercial_discount_must_be_percentage");
  assertPercentage(lowMarginThreshold, "commercial_low_margin_threshold_must_be_percentage");
  assertPercentage(highDiscountThreshold, "commercial_high_discount_threshold_must_be_percentage");
  const reasons: CommercialApprovalReason[] = [];

  if (margin.grossMarginPercent < lowMarginThreshold) reasons.push("low_margin");
  if (input.discountPercent >= highDiscountThreshold) reasons.push("high_discount");
  if (requiresApprovalForAction(input.action)) reasons.push("unsafe_action");

  return {
    ...margin,
    decision: reasons.length > 0 ? "requires_approval" : "allowed",
    blocked: reasons.length > 0,
    reasons,
  };
}

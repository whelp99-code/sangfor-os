export type AllowedOperator = "eq" | "in" | "gte" | "lte" | "all" | "any";

export const ALLOWED_OPERATORS: readonly AllowedOperator[] = [
  "eq",
  "in",
  "gte",
  "lte",
  "all",
  "any",
] as const;

export class RuleEngineError extends Error {
  readonly code: "VALIDATION_ERROR" | "EXECUTION_ERROR";
  readonly httpStatus: number;

  constructor(code: "VALIDATION_ERROR" | "EXECUTION_ERROR", message: string) {
    super(message);
    this.name = "RuleEngineError";
    this.code = code;
    this.httpStatus = code === "VALIDATION_ERROR" ? 422 : 400;
  }
}

function sanitizeValue(value: unknown, depth = 0): void {
  if (depth > 10) {
    throw new RuleEngineError("VALIDATION_ERROR", "Payload depth exceeds maximum allowed limit (10)");
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new RuleEngineError("VALIDATION_ERROR", "NaN or Infinity values are strictly forbidden");
    }
    return;
  }

  if (typeof value === "string") {
    const lower = value.toLowerCase();
    if (
      lower.includes("function") ||
      lower.includes("eval(") ||
      lower.includes("import(") ||
      lower.includes("process.") ||
      lower.includes("__proto__")
    ) {
      throw new RuleEngineError("VALIDATION_ERROR", "Executable or malicious code detected in string payload");
    }
    return;
  }

  if (Array.isArray(value)) {
    if (value.length > 100) {
      throw new RuleEngineError("VALIDATION_ERROR", "Array size exceeds maximum allowed limit (100)");
    }
    for (const item of value) {
      sanitizeValue(item, depth + 1);
    }
    return;
  }

  if (typeof value === "object" && value !== null) {
    const keys = Object.keys(value);
    for (const key of keys) {
      if (key === "__proto__" || key === "constructor" || key === "prototype") {
        throw new RuleEngineError("VALIDATION_ERROR", `Forbidden prototype key detected: ${key}`);
      }
      sanitizeValue((value as Record<string, unknown>)[key], depth + 1);
    }
    return;
  }

  if (typeof value === "function" || typeof value === "symbol") {
    throw new RuleEngineError("VALIDATION_ERROR", "Functions and symbols are forbidden in rule payload");
  }
}

export interface SizingTier {
  minUsers: number;
  maxUsers: number;
  recommendedSkuId: string;
  recommendedCpu?: number;
  recommendedRamGb?: number;
  recommendedDiskGb?: number;
  notes?: string;
}

export interface SizingRuleCondition {
  field: string;
  operator: AllowedOperator;
  value: unknown;
}

export interface SizingRulePayload {
  version: "v1";
  baseSkuId?: string;
  tiers?: SizingTier[];
  rules?: SizingRuleCondition[];
}

export interface CompatibilityCondition {
  field: string;
  operator: AllowedOperator;
  value: unknown;
}

export interface CompatibilityRulePayload {
  version: "v1";
  sourceSkuId: string;
  targetSkuId: string;
  conditions: CompatibilityCondition[];
  incompatibleSeverity?: "WARNING" | "BLOCKER";
  incompatibleMessage?: string;
}

export function validateRulePayload(payload: unknown): void {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new RuleEngineError("VALIDATION_ERROR", "Rule payload must be a non-null object");
  }
  sanitizeValue(payload);
}

function evaluateCondition(operator: AllowedOperator, targetValue: unknown, expectedValue: unknown): boolean {
  switch (operator) {
    case "eq":
      return targetValue === expectedValue;
    case "in":
      if (!Array.isArray(expectedValue)) return false;
      return expectedValue.includes(targetValue);
    case "gte":
      if (typeof targetValue !== "number" || typeof expectedValue !== "number") return false;
      return targetValue >= expectedValue;
    case "lte":
      if (typeof targetValue !== "number" || typeof expectedValue !== "number") return false;
      return targetValue <= expectedValue;
    case "all":
      if (!Array.isArray(targetValue) || !Array.isArray(expectedValue)) return false;
      return expectedValue.every((item) => targetValue.includes(item));
    case "any":
      if (!Array.isArray(targetValue) || !Array.isArray(expectedValue)) return false;
      return expectedValue.some((item) => targetValue.includes(item));
    default:
      throw new RuleEngineError("VALIDATION_ERROR", `Unsupported operator: ${operator}`);
  }
}

export interface SizingEvaluationResult {
  version: "v1";
  baseSkuId: string | null;
  recommendedSkuId: string | null;
  recommendedCpu: number | null;
  recommendedRamGb: number | null;
  recommendedDiskGb: number | null;
  matchedTier: SizingTier | null;
  warnings: string[];
  blockingReasons: string[];
  solutionFitPassed: boolean;
}

export function evaluateSizingRule(
  payload: SizingRulePayload,
  inputs: Record<string, unknown>
): SizingEvaluationResult {
  validateRulePayload(payload);

  if (payload.version !== "v1") {
    throw new RuleEngineError("VALIDATION_ERROR", "Only version 'v1' sizing rules are supported");
  }

  const warnings: string[] = [];
  const blockingReasons: string[] = [];

  // Evaluate conditions
  if (payload.rules && payload.rules.length > 0) {
    for (const rule of payload.rules) {
      if (!ALLOWED_OPERATORS.includes(rule.operator)) {
        throw new RuleEngineError("VALIDATION_ERROR", `Operator '${rule.operator}' is not in allowlist`);
      }
      const actualVal = inputs[rule.field];
      const match = evaluateCondition(rule.operator, actualVal, rule.value);
      if (!match) {
        blockingReasons.push(`Sizing rule condition failed: ${rule.field} ${rule.operator} ${JSON.stringify(rule.value)}`);
      }
    }
  }

  // Find matching tier based on userCount if provided
  let matchedTier: SizingTier | null = null;
  const userCount = typeof inputs.userCount === "number" ? inputs.userCount : null;

  if (userCount !== null && payload.tiers && payload.tiers.length > 0) {
    for (const tier of payload.tiers) {
      if (userCount >= tier.minUsers && userCount <= tier.maxUsers) {
        matchedTier = tier;
        break;
      }
    }
  }

  const solutionFitPassed = blockingReasons.length === 0;

  return {
    version: "v1",
    baseSkuId: payload.baseSkuId ?? null,
    recommendedSkuId: matchedTier?.recommendedSkuId ?? payload.baseSkuId ?? null,
    recommendedCpu: matchedTier?.recommendedCpu ?? null,
    recommendedRamGb: matchedTier?.recommendedRamGb ?? null,
    recommendedDiskGb: matchedTier?.recommendedDiskGb ?? null,
    matchedTier,
    warnings,
    blockingReasons,
    solutionFitPassed,
  };
}

export interface CompatibilityEvaluationResult {
  version: "v1";
  sourceSkuId: string;
  targetSkuId: string;
  compatible: boolean;
  severity: "WARNING" | "BLOCKER";
  warnings: string[];
  blockingReasons: string[];
  solutionFitPassed: boolean;
}

export function evaluateCompatibilityRule(
  payload: CompatibilityRulePayload,
  inputs: Record<string, unknown>
): CompatibilityEvaluationResult {
  validateRulePayload(payload);

  if (payload.version !== "v1") {
    throw new RuleEngineError("VALIDATION_ERROR", "Only version 'v1' compatibility rules are supported");
  }

  const warnings: string[] = [];
  const blockingReasons: string[] = [];
  const severity = payload.incompatibleSeverity ?? "BLOCKER";

  if (payload.conditions && payload.conditions.length > 0) {
    for (const cond of payload.conditions) {
      if (!ALLOWED_OPERATORS.includes(cond.operator)) {
        throw new RuleEngineError("VALIDATION_ERROR", `Operator '${cond.operator}' is not in allowlist`);
      }
      const actualVal = inputs[cond.field];
      const match = evaluateCondition(cond.operator, actualVal, cond.value);
      if (!match) {
        const msg = payload.incompatibleMessage ?? `Compatibility condition failed: ${cond.field} ${cond.operator} ${JSON.stringify(cond.value)}`;
        if (severity === "BLOCKER") {
          blockingReasons.push(msg);
        } else {
          warnings.push(msg);
        }
      }
    }
  }

  const compatible = blockingReasons.length === 0;

  return {
    version: "v1",
    sourceSkuId: payload.sourceSkuId,
    targetSkuId: payload.targetSkuId,
    compatible,
    severity,
    warnings,
    blockingReasons,
    solutionFitPassed: compatible,
  };
}

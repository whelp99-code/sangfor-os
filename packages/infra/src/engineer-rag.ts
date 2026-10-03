import { createHash } from "node:crypto";

/** Optional metadata stays unknown until a consumer has enough evidence to use it. */
export interface RagHit {
  id?: string;
  title?: string;
  section?: string;
  text?: string;
  source?: string;
  product?: string;
  version?: string;
  trustLevel?: string;
  sourceType?: string;
  sourceVisibility?: "public" | "internal" | "restricted" | "unknown";
  customerShareable?: boolean;
  textSha256?: string;
  score?: number;
  rerankScore?: number;
  retrievalMode?: string;
}

type DiagnosticValue = string | number | boolean | null | DiagnosticValue[] | { [key: string]: DiagnosticValue };

export interface RagSearchDiagnostics {
  degraded?: boolean;
  searchMode?: string;
  evidenceRequirement?: string;
  [key: string]: DiagnosticValue | undefined;
}

export interface RagSearchResult {
  query?: string;
  results: RagHit[];
  diagnostics?: RagSearchDiagnostics;
}

const MAX_RESULTS = 20;
const MAX_TEXT_LENGTH = 12_000;
const MAX_DIAGNOSTICS_LENGTH = 16_000;

function invalid(field: string): never {
  throw new Error(`Invalid engineer RAG response: ${field}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function optionalString(value: unknown, field: string, maxLength: number): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim() || value.length > maxLength) invalid(field);
  return value;
}

function optionalNumber(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) invalid(field);
  return value;
}

function optionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") invalid(field);
  return value;
}

function optionalSourceVisibility(value: unknown, field: string): RagHit["sourceVisibility"] {
  if (value === undefined) return undefined;
  if (value === "public" || value === "internal" || value === "restricted" || value === "unknown") return value;
  return invalid(field);
}

function normalizeHit(value: unknown, index: number): RagHit {
  const field = `results[${index}]`;
  if (!isRecord(value)) invalid(field);
  const text = optionalString(value.text, `${field}.text`, MAX_TEXT_LENGTH);
  const source = optionalString(value.source, `${field}.source`, 2_048);
  const filePath = optionalString(value.filePath, `${field}.filePath`, 2_048);
  const sourceVisibility = optionalSourceVisibility(value.sourceVisibility, `${field}.sourceVisibility`);
  const customerShareable = optionalBoolean(value.customerShareable, `${field}.customerShareable`);
  const suppliedHash = optionalString(value.textSha256, `${field}.textSha256`, 64);
  // Hash the exact returned text. Never truncate it or trust an upstream digest blindly.
  const textSha256 = text === undefined ? undefined : createHash("sha256").update(text, "utf8").digest("hex");
  if (suppliedHash !== undefined && (!/^[a-f\d]{64}$/i.test(suppliedHash) || suppliedHash.toLowerCase() !== textSha256)) {
    invalid(`${field}.textSha256`);
  }

  // An allowlist keeps raw vectors, content hashes and arbitrary upstream fields out of evidence.
  return {
    id: optionalString(value.id, `${field}.id`, 512),
    title: optionalString(value.title, `${field}.title`, 1_000),
    section: optionalString(value.section, `${field}.section`, 1_000),
    text,
    source: source ?? filePath,
    product: optionalString(value.product, `${field}.product`, 100),
    version: optionalString(value.version, `${field}.version`, 100),
    trustLevel: optionalString(value.trustLevel, `${field}.trustLevel`, 100),
    sourceType: optionalString(value.sourceType, `${field}.sourceType`, 100),
    // Neither official trust nor a source URL establishes permission to share it.
    ...(sourceVisibility === undefined ? {} : { sourceVisibility }),
    ...(customerShareable === undefined ? {} : { customerShareable }),
    textSha256,
    score: optionalNumber(value.score, `${field}.score`),
    rerankScore: optionalNumber(value.rerankScore, `${field}.rerankScore`),
    retrievalMode: optionalString(value.retrievalMode, `${field}.retrievalMode`, 100),
  };
}

function diagnosticValue(value: unknown, field: string, depth = 0, budget = { remaining: 1_000 }): DiagnosticValue {
  if (depth > 6 || --budget.remaining < 0) invalid(field);
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.length <= 2_000) return value;
  if (Array.isArray(value) && value.length <= 100) {
    return value.map((entry, index) => diagnosticValue(entry, `${field}[${index}]`, depth + 1, budget));
  }
  if (isRecord(value) && Object.keys(value).length <= 100) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => {
      if (key.length > 100) invalid(field);
      return [key, diagnosticValue(entry, `${field}.${key}`, depth + 1, budget)];
    }));
  }
  return invalid(field);
}

function normalizeDiagnostics(envelope: Record<string, unknown>): RagSearchDiagnostics | undefined {
  let diagnostics: RagSearchDiagnostics | undefined;
  if (envelope.diagnostics !== undefined) {
    if (!isRecord(envelope.diagnostics)) invalid("diagnostics");
    diagnostics = diagnosticValue(envelope.diagnostics, "diagnostics") as RagSearchDiagnostics;
  }

  for (const field of ["degraded", "searchMode", "evidenceRequirement"] as const) {
    const topLevelValue = field === "degraded"
      ? optionalBoolean(envelope[field], `diagnostics.${field}`)
      : optionalString(envelope[field], `diagnostics.${field}`, 100);
    const nestedValue = field === "degraded"
      ? optionalBoolean(diagnostics?.[field], `diagnostics.${field}`)
      : optionalString(diagnostics?.[field], `diagnostics.${field}`, 100);
    if (topLevelValue !== undefined) {
      if (nestedValue !== undefined && nestedValue !== topLevelValue) invalid(`diagnostics.${field} conflict`);
      diagnostics = { ...diagnostics, [field]: topLevelValue };
    }
  }
  if (diagnostics && JSON.stringify(diagnostics).length > MAX_DIAGNOSTICS_LENGTH) invalid("diagnostics");
  return diagnostics;
}

/** Normalize both the current envelope and legacy arrays without inventing trust or health. */
export function normalizeRagSearchResult(raw: unknown): RagSearchResult {
  const envelope: Record<string, unknown> = Array.isArray(raw) ? { results: raw } : isRecord(raw) ? raw : invalid("envelope");
  if (!Array.isArray(envelope.results) || envelope.results.length > MAX_RESULTS) invalid("results");
  if (envelope.error !== undefined) invalid("error");
  return {
    query: optionalString(envelope.query, "query", 8_000),
    results: envelope.results.map(normalizeHit),
    diagnostics: normalizeDiagnostics(envelope),
  };
}

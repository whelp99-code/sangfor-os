type TraceEventName =
  | "phase13.skillRecommendation"
  | "phase13.skillExecution"
  | "phase14.contextPack"
  | "phase15.convertToPhase13"
  | "actionRuntime.validation";

export type TraceWorkflowEventInput = {
  event: TraceEventName;
  phase?: number;
  commandRunId?: string;
  skillRunId?: string;
  skillKey?: string;
  executionMode?: "template" | "llm";
  fallbackReason?: string | null;
  contextPackSummary?: string | null;
  templateKey?: string | null;
  templateOutputSummary?: string | null;
  improvementCandidateId?: string;
  actionKey?: string;
  actionValidationResult?: {
    valid: boolean;
    errors: string[];
    warnings: string[];
    connectorMode?: string | null;
  };
  metadata?: Record<string, unknown>;
};

export type SafeTracePayload = {
  event: TraceEventName;
  timestamp: string;
  phase: number | null;
  commandRunId: string | null;
  skillRunId: string | null;
  skillKey: string | null;
  executionMode: "template" | "llm" | null;
  fallbackReason: string | null;
  contextPackSummary: string | null;
  templateKey: string | null;
  templateOutputSummary: string | null;
  improvementCandidateId: string | null;
  actionKey: string | null;
  actionValidationResult: TraceWorkflowEventInput["actionValidationResult"] | null;
  metadata: Record<string, unknown>;
};

const warningSink: string[] = [];

export function getObservabilityWarnings(): string[] {
  return [...warningSink];
}

export function resetObservabilityWarningsForTests() {
  warningSink.length = 0;
}

function pushWarning(message: string) {
  warningSink.push(message);
}

function toNullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function sanitizeUnknown(value: unknown): unknown {
  if (value == null) return value;
  if (Array.isArray(value)) return value.map((item) => sanitizeUnknown(item));
  if (typeof value !== "object") return value;

  const blocked = /(secret|token|password|authorization|api[_-]?key)/i;
  const out: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (blocked.test(key)) {
      out[key] = "[REDACTED]";
      continue;
    }
    out[key] = sanitizeUnknown(raw);
  }
  return out;
}

export function toSafeTracePayload(input: TraceWorkflowEventInput): SafeTracePayload {
  return {
    event: input.event,
    timestamp: new Date().toISOString(),
    phase: typeof input.phase === "number" ? input.phase : null,
    commandRunId: toNullableString(input.commandRunId),
    skillRunId: toNullableString(input.skillRunId),
    skillKey: toNullableString(input.skillKey),
    executionMode: input.executionMode ?? null,
    fallbackReason: toNullableString(input.fallbackReason),
    contextPackSummary: toNullableString(input.contextPackSummary),
    templateKey: toNullableString(input.templateKey),
    templateOutputSummary: toNullableString(input.templateOutputSummary),
    improvementCandidateId: toNullableString(input.improvementCandidateId),
    actionKey: toNullableString(input.actionKey),
    actionValidationResult: input.actionValidationResult
      ? {
          valid: input.actionValidationResult.valid,
          errors: [...input.actionValidationResult.errors],
          warnings: [...input.actionValidationResult.warnings],
          connectorMode: toNullableString(input.actionValidationResult.connectorMode),
        }
      : null,
    metadata: (sanitizeUnknown(input.metadata) as Record<string, unknown>) ?? {},
  };
}

export interface ObservabilityAdapter {
  traceWorkflowEvent(input: TraceWorkflowEventInput): Promise<void>;
}

export class NoopObservabilityAdapter implements ObservabilityAdapter {
  async traceWorkflowEvent(): Promise<void> {
    return;
  }
}

export class LangfuseObservabilityAdapter implements ObservabilityAdapter {
  private readonly publicKey: string;
  private readonly secretKey: string;
  private readonly baseUrl: string;

  constructor(config: { publicKey: string; secretKey: string; baseUrl: string }) {
    this.publicKey = config.publicKey;
    this.secretKey = config.secretKey;
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
  }

  async traceWorkflowEvent(input: TraceWorkflowEventInput): Promise<void> {
    const payload = toSafeTracePayload(input);
    const credentials = Buffer.from(`${this.publicKey}:${this.secretKey}`).toString("base64");

    const body = {
      id: payload.commandRunId ?? `${payload.event}-${Date.now()}`,
      timestamp: payload.timestamp,
      name: payload.event,
      input: payload.metadata,
      output: {
        phase: payload.phase,
        skillRunId: payload.skillRunId,
        skillKey: payload.skillKey,
        executionMode: payload.executionMode,
        fallbackReason: payload.fallbackReason,
        contextPackSummary: payload.contextPackSummary,
        templateKey: payload.templateKey,
        templateOutputSummary: payload.templateOutputSummary,
        improvementCandidateId: payload.improvementCandidateId,
        actionKey: payload.actionKey,
        actionValidationResult: payload.actionValidationResult,
      },
      metadata: {
        commandRunId: payload.commandRunId,
      },
    };

    await fetch(`${this.baseUrl}/api/public/traces`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Basic ${credentials}`,
      },
      body: JSON.stringify(body),
    });
  }
}

let cachedAdapter: ObservabilityAdapter | null = null;

export function resetObservabilityAdapterForTests() {
  cachedAdapter = null;
}

export function getObservabilityAdapter(): ObservabilityAdapter {
  if (cachedAdapter) return cachedAdapter;

  const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
  const secretKey = process.env.LANGFUSE_SECRET_KEY;
  const baseUrl = process.env.LANGFUSE_BASE_URL;

  if (
    typeof publicKey === "string" &&
    publicKey.length > 0 &&
    typeof secretKey === "string" &&
    secretKey.length > 0 &&
    typeof baseUrl === "string" &&
    baseUrl.length > 0
  ) {
    cachedAdapter = new LangfuseObservabilityAdapter({ publicKey, secretKey, baseUrl });
    return cachedAdapter;
  }

  cachedAdapter = new NoopObservabilityAdapter();
  return cachedAdapter;
}

export async function traceWorkflowEvent(input: TraceWorkflowEventInput): Promise<void> {
  try {
    await getObservabilityAdapter().traceWorkflowEvent(input);
  } catch (error) {
    pushWarning(
      `observability_trace_failed:${error instanceof Error ? error.message : "unknown_error"}`,
    );
  }
}

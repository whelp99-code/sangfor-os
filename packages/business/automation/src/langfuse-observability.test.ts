import { afterEach, describe, expect, it, vi } from "vitest";

import {
  LangfuseObservabilityAdapter,
  NoopObservabilityAdapter,
  getObservabilityAdapter,
  getObservabilityWarnings,
  resetObservabilityAdapterForTests,
  resetObservabilityWarningsForTests,
  toSafeTracePayload,
  traceWorkflowEvent,
} from "./langfuse-observability";

const savedEnv = {
  LANGFUSE_PUBLIC_KEY: process.env.LANGFUSE_PUBLIC_KEY,
  LANGFUSE_SECRET_KEY: process.env.LANGFUSE_SECRET_KEY,
  LANGFUSE_BASE_URL: process.env.LANGFUSE_BASE_URL,
};

afterEach(() => {
  if (savedEnv.LANGFUSE_PUBLIC_KEY === undefined) delete process.env.LANGFUSE_PUBLIC_KEY;
  else process.env.LANGFUSE_PUBLIC_KEY = savedEnv.LANGFUSE_PUBLIC_KEY;
  if (savedEnv.LANGFUSE_SECRET_KEY === undefined) delete process.env.LANGFUSE_SECRET_KEY;
  else process.env.LANGFUSE_SECRET_KEY = savedEnv.LANGFUSE_SECRET_KEY;
  if (savedEnv.LANGFUSE_BASE_URL === undefined) delete process.env.LANGFUSE_BASE_URL;
  else process.env.LANGFUSE_BASE_URL = savedEnv.LANGFUSE_BASE_URL;
  resetObservabilityAdapterForTests();
  resetObservabilityWarningsForTests();
  vi.restoreAllMocks();
});

describe("langfuse-observability", () => {
  it("uses no-op adapter and does not throw when env is missing", async () => {
    delete process.env.LANGFUSE_PUBLIC_KEY;
    delete process.env.LANGFUSE_SECRET_KEY;
    delete process.env.LANGFUSE_BASE_URL;

    const adapter = getObservabilityAdapter();
    expect(adapter).toBeInstanceOf(NoopObservabilityAdapter);
    await expect(
      traceWorkflowEvent({
        event: "phase13.skillRecommendation",
        phase: 13,
        metadata: { recommendedSkillKeys: ["aios-work-breakdown"] },
      }),
    ).resolves.toBeUndefined();
  });

  it("produces stable safe payload shape and redacts metadata secrets", () => {
    const payload = toSafeTracePayload({
      event: "actionRuntime.validation",
      phase: 13,
      actionKey: "github.sync-pr",
      actionValidationResult: {
        valid: true,
        errors: [],
        warnings: [],
        connectorMode: "mock",
      },
      metadata: {
        connectorKey: "github",
        apiKey: "raw-secret-key",
        nested: {
          tokenValue: "nope",
          keep: "ok",
        },
      },
    });

    expect(payload.event).toBe("actionRuntime.validation");
    expect(payload.phase).toBe(13);
    expect(payload.actionValidationResult?.connectorMode).toBe("mock");
    expect(payload.metadata.apiKey).toBe("[REDACTED]");
    expect((payload.metadata.nested as { tokenValue: string }).tokenValue).toBe("[REDACTED]");
  });

  it("langfuse adapter sends payload without embedding secret values", async () => {
    process.env.LANGFUSE_PUBLIC_KEY = "pk_test";
    process.env.LANGFUSE_SECRET_KEY = "sk_test";
    process.env.LANGFUSE_BASE_URL = "https://langfuse.example.com";
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue({ ok: true } as Response);

    const adapter = getObservabilityAdapter();
    expect(adapter).toBeInstanceOf(LangfuseObservabilityAdapter);

    await traceWorkflowEvent({
      event: "phase14.contextPack",
      phase: 14,
      templateKey: "proposal_prd",
      templateOutputSummary: "rendered summary",
      metadata: { sourceEntityType: "proposal" },
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, init] = fetchSpy.mock.calls[0]!;
    const requestBody = String(init?.body ?? "");
    expect(requestBody.includes("sk_test")).toBe(false);
    expect(requestBody.includes("pk_test")).toBe(false);
    expect(requestBody.includes("phase14.contextPack")).toBe(true);
  });

  it("swallows adapter failures and records warning", async () => {
    process.env.LANGFUSE_PUBLIC_KEY = "pk_test";
    process.env.LANGFUSE_SECRET_KEY = "sk_test";
    process.env.LANGFUSE_BASE_URL = "https://langfuse.example.com";
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network_down"));

    await expect(
      traceWorkflowEvent({
        event: "phase15.convertToPhase13",
        phase: 15,
        improvementCandidateId: "imp-1",
      }),
    ).resolves.toBeUndefined();
    expect(getObservabilityWarnings().some((entry) => entry.includes("observability_trace_failed"))).toBe(
      true,
    );
  });
});

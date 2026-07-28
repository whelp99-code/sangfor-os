import { describe, expect, it } from "vitest";

import {
  WorkflowRuntimeError,
  RUN_STATUSES,
  STEP_STATUSES,
  assertRunTransition,
  assertStepTransition,
  normalizeWorkflowInput,
} from "./workflow-contracts";
import { workflowStartRetryDelayMs } from "./workflow-runtime";

describe("canonical persisted workflow runtime contracts", () => {
  it("binds the exhaustive U019 run state graph and never reopens terminal rows", () => {
    expect(() => assertRunTransition("pending", "running")).not.toThrow();
    expect(() => assertRunTransition("running", "blocked")).not.toThrow();
    expect(() => assertRunTransition("blocked", "failed")).not.toThrow();
    const allowed: Record<(typeof RUN_STATUSES)[number], readonly string[]> = { pending: ["running", "cancelled"], running: ["blocked", "succeeded", "failed", "cancelled"], blocked: ["running", "failed", "cancelled"], succeeded: [], failed: [], cancelled: [], legacy_imported: [] };
    for (const from of RUN_STATUSES) for (const to of RUN_STATUSES) {
      if (allowed[from].includes(to)) expect(() => assertRunTransition(from, to)).not.toThrow();
      else expect(() => assertRunTransition(from, to)).toThrow(WorkflowRuntimeError);
    }
  });

  it("binds the exhaustive U019 step graph and never reopens terminal rows", () => {
    expect(() => assertStepTransition("pending", "skipped")).not.toThrow();
    expect(() => assertStepTransition("running", "succeeded")).not.toThrow();
    expect(() => assertStepTransition("blocked", "cancelled")).not.toThrow();
    const allowed: Record<(typeof STEP_STATUSES)[number], readonly string[]> = { pending: ["running", "skipped", "cancelled"], running: ["blocked", "succeeded", "failed", "cancelled"], blocked: ["running", "failed", "cancelled"], succeeded: [], failed: [], skipped: [], cancelled: [] };
    for (const from of STEP_STATUSES) for (const to of STEP_STATUSES) {
      if (allowed[from].includes(to)) expect(() => assertStepTransition(from, to)).not.toThrow();
      else expect(() => assertStepTransition(from, to)).toThrow(WorkflowRuntimeError);
    }
  });

  it("normalizes a persisted input snapshot and rejects non-JSON input", () => {
    expect(normalizeWorkflowInput({ nested: { b: 2, a: 1 } })).toEqual({ nested: { a: 1, b: 2 } });
    expect(() => normalizeWorkflowInput({ value: undefined })).toThrow(WorkflowRuntimeError);
  });

  it("backs off serialization retries with a bounded deterministic jitter", () => {
    const delays = Array.from({ length: 8 }, (_, attempt) => workflowStartRetryDelayMs("workflow-key", attempt));
    expect(delays).toEqual([...delays].sort((left, right) => left - right));
    expect(delays.at(-1)).toBeLessThanOrEqual(258);
    expect(workflowStartRetryDelayMs("another-key", 2)).not.toBe(workflowStartRetryDelayMs("workflow-key", 2));
  });
});

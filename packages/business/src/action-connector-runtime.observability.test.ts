import { describe, expect, it, vi } from "vitest";

const traceWorkflowEvent = vi.fn<(input: Record<string, unknown>) => Promise<void>>(
  async (_input) => undefined,
);

vi.mock("./langfuse-observability", () => ({
  traceWorkflowEvent,
}));

describe("action-connector-runtime observability wiring", () => {
  it("emits a validation trace event", async () => {
    const { validateAction } = await import("./action-connector-runtime");
    traceWorkflowEvent.mockClear();

    const result = validateAction("phase13.run");
    expect(result.valid).toBe(true);
    expect(traceWorkflowEvent).toHaveBeenCalledTimes(1);
    expect(traceWorkflowEvent.mock.calls[0]?.[0]).toMatchObject({
      event: "actionRuntime.validation",
      actionKey: "phase13.run",
    });
  });
});

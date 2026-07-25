import { describe, expect, it } from "vitest";
import { registerSchedulerHandler, getSchedulerHandler, hasSchedulerHandler } from "./scheduler-handler-registry";

describe("U069: scheduler-handler-registry unit tests", () => {
  it("registers and retrieves scheduler handlers", () => {
    registerSchedulerHandler("test_handler", async () => ({ success: true }));
    expect(hasSchedulerHandler("test_handler")).toBe(true);
    expect(getSchedulerHandler("test_handler")).toBeDefined();
  });

  it("has default registered handlers", () => {
    expect(hasSchedulerHandler("daily_briefing")).toBe(true);
    expect(hasSchedulerHandler("kpi_weekly")).toBe(true);
  });
});

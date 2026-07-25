import { describe, expect, it } from "vitest";
import { MODEL_SCOPE_INVENTORY } from "./scope-inventory";

describe("U068: Scheduler Schema Contract", () => {
  it("registers SchedulerJob as COMPANY_ROOT", () => {
    expect(MODEL_SCOPE_INVENTORY.SchedulerJob).toBeDefined();
    expect(MODEL_SCOPE_INVENTORY.SchedulerJob.category).toBe("COMPANY_ROOT");
  });

  it("registers SchedulerRun as CHILD_VIA_FK to SchedulerJob", () => {
    expect(MODEL_SCOPE_INVENTORY.SchedulerRun).toBeDefined();
    expect(MODEL_SCOPE_INVENTORY.SchedulerRun.category).toBe("CHILD_VIA_FK");
    if (MODEL_SCOPE_INVENTORY.SchedulerRun.category === "CHILD_VIA_FK") {
      expect(MODEL_SCOPE_INVENTORY.SchedulerRun.parentModel).toBe("SchedulerJob");
    }
  });

  it("registers SchedulerRunAttempt as CHILD_VIA_FK to SchedulerRun", () => {
    expect(MODEL_SCOPE_INVENTORY.SchedulerRunAttempt).toBeDefined();
    expect(MODEL_SCOPE_INVENTORY.SchedulerRunAttempt.category).toBe("CHILD_VIA_FK");
    if (MODEL_SCOPE_INVENTORY.SchedulerRunAttempt.category === "CHILD_VIA_FK") {
      expect(MODEL_SCOPE_INVENTORY.SchedulerRunAttempt.parentModel).toBe("SchedulerRun");
    }
  });
});

import { describe, expect, it } from "vitest";
import { listScheduledJobs, triggerScheduledJob } from "./scheduler-runtime";
import type { AuthContext } from "@sangfor/auth";

const CTX: AuthContext = {
  userId: "u1", sessionId: "s1", tenantId: "t1", companyId: "c1", projectId: "p1",
  businessRole: "system_admin", permissions: [], product: "portal",
};

describe("U069: scheduler-runtime unit tests", () => {
  it("lists scheduled jobs from catalog", async () => {
    const jobs = await listScheduledJobs({ authContext: CTX });
    expect(jobs.length).toBeGreaterThan(0);
    expect(jobs[0].jobKey).toBe("daily-briefing");
  });

  it("triggers scheduled job successfully", async () => {
    const res = await triggerScheduledJob({ authContext: CTX, jobKey: "daily-briefing" });
    expect(res.status).toBe("SUCCEEDED");
    expect(res.runId).toBeDefined();
  });
});

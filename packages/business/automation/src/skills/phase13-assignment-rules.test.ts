import { describe, expect, it } from "vitest";

import { recommendAssignmentForWorkItem } from "./phase13-assignment-rules";

describe("phase13 assignment rules", () => {
  it("routes Prisma migration work to codex", () => {
    const result = recommendAssignmentForWorkItem({
      title: "Add Prisma migration for source entity",
      targetArea: "packages/db",
    });
    expect(result.suggestedAgent).toBe("codex");
  });

  it("routes proposal detail form to cursor", () => {
    const result = recommendAssignmentForWorkItem({
      title: "Build proposal detail form",
      description: "React page component for proposals",
      targetArea: "apps/web",
    });
    expect(result.suggestedAgent).toBe("cursor");
  });

  it("routes release notes to docs", () => {
    const result = recommendAssignmentForWorkItem({
      title: "Update release notes",
      description: "docs/reports daily status",
    });
    expect(["docs", "cursor"]).toContain(result.suggestedAgent);
  });

  it("routes auth secret review to codex with security reason", () => {
    const result = recommendAssignmentForWorkItem({
      title: "Review auth secret handling",
      description: "JWT_SECRET validation path",
    });
    expect(result.suggestedAgent).toBe("codex");
    expect(result.reason.toLowerCase()).toContain("security");
  });

  it("routes vague experience goals to needs_triage", () => {
    const result = recommendAssignmentForWorkItem({
      title: "Improve experience",
      description: "Make the portal feel better",
    });
    expect(result.suggestedAgent).toBe("needs_triage");
  });
});

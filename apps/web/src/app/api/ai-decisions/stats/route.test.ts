import { describe, expect, it, beforeEach, vi } from "vitest";

const { mockGetDecisionStats } = vi.hoisted(() => ({
  mockGetDecisionStats: vi.fn(),
}));
vi.mock("@sangfor/business", () => ({ getDecisionStats: mockGetDecisionStats }));

import { GET } from "./route";

beforeEach(() => mockGetDecisionStats.mockReset());

function req(url = "http://localhost/api/ai-decisions/stats") {
  return new Request(url);
}

describe("GET /api/ai-decisions/stats", () => {
  it("returns 200 with the decision stats read-model", async () => {
    mockGetDecisionStats.mockResolvedValue({
      byActorAction: [
        { actor: "sales", actionType: "stage_transition", approved: 2, rejected: 1, corrected: 0, total: 3 },
      ],
      confidenceBuckets: { low: 1, medium: 1, high: 1 },
    });

    const res = await GET(req());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.byActorAction).toHaveLength(1);
    expect(body.confidenceBuckets).toEqual({ low: 1, medium: 1, high: 1 });
    // No scope params → called without a where filter.
    expect(mockGetDecisionStats).toHaveBeenCalledWith({});
  });

  it("passes projectId/domain scope through to the read-model", async () => {
    mockGetDecisionStats.mockResolvedValue({ byActorAction: [], confidenceBuckets: { low: 0, medium: 0, high: 0 } });

    const res = await GET(req("http://localhost/api/ai-decisions/stats?projectId=proj_1&domain=sales"));
    expect(res.status).toBe(200);
    expect(mockGetDecisionStats).toHaveBeenCalledWith({
      where: { projectId: "proj_1", domain: "sales" },
    });
  });

  it("returns a sanitized 400 error payload when the read-model throws", async () => {
    mockGetDecisionStats.mockImplementationOnce(() => {
      throw new Error("db exploded with secret detail");
    });

    const res = await GET(req());
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("ai_decision_stats_failed");
    // Raw error detail must not leak.
    expect(JSON.stringify(body)).not.toContain("secret detail");
  });
});

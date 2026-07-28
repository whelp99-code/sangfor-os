import { describe, expect, it } from "vitest";
import { previewAssetRenewalThresholds } from "./asset-renewal";

describe("asset-renewal pure adapter unit tests", () => {
  it("previews renewal opportunities deterministically with injected clock", () => {
    const now = new Date(Date.UTC(2026, 0, 1));
    const warrantyEnd = new Date(Date.UTC(2026, 0, 15));

    const res = previewAssetRenewalThresholds(
      [
        {
          id: "a1", customerId: "c1", productName: "FW", status: "active", warrantyEnd,
        },
      ],
      now,
      30,
    );

    expect(res).toHaveLength(1);
    expect(res[0].assetId).toBe("a1");
    expect(res[0].dueDate).toEqual(warrantyEnd);
  });
});

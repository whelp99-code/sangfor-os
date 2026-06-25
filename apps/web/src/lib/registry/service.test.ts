import { describe, expect, it } from "vitest";

import { getRegistryCounts, loadPageBlocks } from "./service";

describe.skipIf(process.env.CI_INTEGRATION !== "1")("registry service", () => {
  it("loads dashboard blocks from layout_slots", async () => {
    const blocks = await loadPageBlocks("dashboard");
    expect(blocks.length).toBeGreaterThan(0);
    expect(blocks[0]?.blockKey).toBe("dashboard-metrics");
  });

  it("returns registry counts via query handler path", async () => {
    const counts = await getRegistryCounts();
    expect(counts.modules).toBeGreaterThan(0);
    expect(counts.blocks).toBeGreaterThan(0);
  });
});

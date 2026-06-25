import { describe, expect, it } from "vitest";

import { mapWithConcurrency } from "./map-with-concurrency";

describe("mapWithConcurrency", () => {
  it("preserves order while running concurrently", async () => {
    const input = [1, 2, 3, 4];
    const output = await mapWithConcurrency(input, 2, async (value) => {
      await new Promise((resolve) => setTimeout(resolve, 10 * (5 - value)));
      return value * 2;
    });
    expect(output).toEqual([2, 4, 6, 8]);
  });
});

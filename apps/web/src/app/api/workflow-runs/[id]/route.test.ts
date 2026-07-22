import { describe, expect, it } from "vitest";
import { GET, PATCH } from "./route";

describe("GET/PATCH /api/workflow-runs/:id", () => {
  it("exists as the canonical persisted-run read/transition entry point", () => {
    expect(GET).toBeTypeOf("function");
    expect(PATCH).toBeTypeOf("function");
  });
});

import { describe, expect, it } from "vitest";
import { POST } from "./route";

describe("POST /api/workflow-definitions", () => {
  it("exists as the canonical persisted-definition entry point", () => {
    expect(POST).toBeTypeOf("function");
  });
});

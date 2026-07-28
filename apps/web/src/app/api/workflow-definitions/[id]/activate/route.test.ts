import { describe, expect, it } from "vitest";
import { POST } from "./route";

describe("POST /api/workflow-definitions/:id/activate", () => {
  it("exists as the approval-gated activation entry point", () => {
    expect(POST).toBeTypeOf("function");
  });
});

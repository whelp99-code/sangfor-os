import { describe, expect, it } from "vitest";
import { PROJECT_NAME, PROJECT_PHASE } from "./index.js";

describe("@sangfor/shared", () => {
  it("exports project constants", () => {
    expect(PROJECT_NAME).toBe("AI Automation Work Portal");
    expect(PROJECT_PHASE).toBe(13);
  });
});

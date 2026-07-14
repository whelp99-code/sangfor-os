import { describe, expect, it } from "vitest";
import { PROJECT_NAME, PROJECT_PHASE } from "./index.js";

describe("@sangfor/shared", () => {
  it("exports project constants", () => {
    expect(PROJECT_NAME).toBe("AI 업무 자동화 포털");
    expect(PROJECT_PHASE).toBe(13);
  });
});

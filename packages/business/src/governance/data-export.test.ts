import { describe, expect, it } from "vitest";
import { issueDataExport } from "./data-export";

describe("U058: data-export unit tests", () => {
  it("data-export re-exports issueDataExport", () => {
    expect(issueDataExport).toBeDefined();
  });
});

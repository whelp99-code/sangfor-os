import { describe, expect, it } from "vitest";
import { computeExactQuoteDiff } from "./approval-detail";

describe("U060: approval-detail unit tests", () => {
  it("computeExactQuoteDiff identifies exact line diffs using exact decimal strings", () => {
    const oldContent = {
      lines: [
        { id: "l1", quantity: "10", unitPrice: "100.00", discount: "0.00", tax: "10.00", lineTotal: "1000.00" },
      ],
    };
    const newContent = {
      lines: [
        { id: "l1", quantity: "10", unitPrice: "90.00", discount: "10.00", tax: "9.00", lineTotal: "900.00" },
      ],
    };

    const diffs = computeExactQuoteDiff(oldContent, newContent);
    expect(diffs).toHaveLength(4); // unitPrice, discount, tax, lineTotal
    expect(diffs.find((d) => d.field === "unitPrice")?.oldValue).toBe("100.00");
    expect(diffs.find((d) => d.field === "unitPrice")?.newValue).toBe("90.00");
  });

  it("returns empty diff for identical line content", () => {
    const content = {
      lines: [{ id: "l1", quantity: "5", unitPrice: "50.00" }],
    };
    const diffs = computeExactQuoteDiff(content, content);
    expect(diffs).toHaveLength(0);
  });
});

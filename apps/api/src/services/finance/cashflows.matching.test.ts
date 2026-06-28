import { describe, expect, it } from "vitest";

import { matchProjectId, normName } from "./cashflows.service";

type Entry = { projectId: string; amount: number };
const maps = (buyer: Record<string, Entry[]>, vendor: Record<string, Entry[]>) => ({
  buyer: new Map(Object.entries(buyer).map(([k, v]) => [normName(k), v])),
  vendor: new Map(Object.entries(vendor).map(([k, v]) => [normName(k), v])),
});

describe("normName", () => {
  it("strips company suffixes/punctuation/spaces and lowercases", () => {
    expect(normName("(주)넥시아스")).toBe("넥시아스");
    expect(normName("주식회사 아지텍")).toBe("아지텍");
    expect(normName("롯데건설(주)")).toBe("롯데건설");
  });
});

describe("matchProjectId", () => {
  const m = maps(
    {
      "주식회사 아지텍": [{ projectId: "p-ilji", amount: 51163200 }],
      "롯데건설(주)": [{ projectId: "p-lotte", amount: 935000 }],
    },
    {
      "(주)넥시아스": [
        { projectId: "p-a", amount: 3000000 },
        { projectId: "p-b", amount: 8030000 },
      ],
    },
  );

  it("matches an inflow to a project by buyer (single project)", () => {
    expect(matchProjectId(m, "주식회사 아지텍", 51163200, true)).toBe("p-ilji");
  });

  it("normalizes the counterparty before matching", () => {
    expect(matchProjectId(m, "아지텍", 999, true)).toBe("p-ilji");
  });

  it("returns null when the counterparty is unknown", () => {
    expect(matchProjectId(m, "롯데카드", 642343, false)).toBeNull();
  });

  it("leaves a multi-project vendor ambiguous unless amount disambiguates", () => {
    expect(matchProjectId(m, "(주)넥시아스", 123, false)).toBeNull();
    expect(matchProjectId(m, "(주)넥시아스", 8030000, false)).toBe("p-b");
  });

  it("does not match an outflow against buyer-only names", () => {
    expect(matchProjectId(m, "주식회사 아지텍", 51163200, false)).toBeNull();
  });
});

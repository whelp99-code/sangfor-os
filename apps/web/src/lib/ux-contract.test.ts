import { describe, expect, it } from "vitest";
import { UX_COPY } from "./ux-copy";

describe("U065: ux-copy unit tests", () => {
  it("provides Korean localized copy strings", () => {
    expect(UX_COPY.loading).toBe("불러오는 중…");
    expect(UX_COPY.retryButton).toBe("다시 시도");
  });
});

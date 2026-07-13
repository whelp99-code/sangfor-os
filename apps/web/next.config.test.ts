import { describe, expect, it } from "vitest";

import nextConfig from "./next.config";

describe("Next development origin allowlist", () => {
  it("hydrates the documented 127.0.0.1 QA origin", () => {
    expect(nextConfig.allowedDevOrigins).toContain("127.0.0.1");
  });
});

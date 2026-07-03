import { describe, expect, it } from "vitest";

import { openApiDocument } from "./openapi";

describe("openApiDocument", () => {
  it("generates a valid OpenAPI 3.x document", () => {
    expect(openApiDocument.openapi).toMatch(/^3\./);
    expect(openApiDocument.info.title).toBe("Sangfor OS API");
    expect(Object.keys(openApiDocument.paths ?? {})).toContain("/hello.greet");
  });
});

import { BUSINESS_ROLE_CODES } from "@sangfor/auth";
import { describe, expect, it } from "vitest";

import { ROLE_LANDING_PATHS, roleLandingPath } from "./role-landing";

describe("role landing paths", () => {
  it("maps every canonical business role to one local route", () => {
    expect(Object.keys(ROLE_LANDING_PATHS).sort()).toEqual([...BUSINESS_ROLE_CODES].sort());
    for (const role of BUSINESS_ROLE_CODES) {
      expect(roleLandingPath(role)).toMatch(/^\/(?!\/)/);
    }
  });
});

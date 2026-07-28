/**
 * U006 — process profile validation (fail-closed production, feature-gated secrets).
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  PROCESS_PROFILES,
  ProcessProfileError,
  assertProcessProfile,
  buildProfileMatrix,
  isFeatureEnabled,
  productionAuthConfigurationIssues,
  resolveProcessProfile,
  validateProcessProfile,
  workflowProductionConfigurationIssues,
} from "./profiles.js";

const STRONG_KEY = "a".repeat(32);
const PRINCIPAL = "operator-principal-1";

function productionBase(
  extra: Record<string, string | undefined> = {},
): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "production",
    SANGFOR_PROCESS_PROFILE: "production",
    SANGFOR_API_KEY: STRONG_KEY,
    MCP_API_KEY: STRONG_KEY,
    SANGFOR_OPERATOR_PRINCIPAL_ID: PRINCIPAL,
    WHELP99_ENFORCE_SAFE_TOOLS: "true",
    API_KEY: STRONG_KEY,
    FINANCE_API_KEY: "b".repeat(32),
    JWT_SECRET: "c".repeat(32),
    AUTH_BYPASS_ENABLED: "0",
    AUTH_PROFILE: "production",
    ...extra,
  };
}

afterEach(() => {
  // no cached state in profiles module
});

describe("resolveProcessProfile", () => {
  it("honors SANGFOR_PROCESS_PROFILE over NODE_ENV", () => {
    expect(
      resolveProcessProfile({
        NODE_ENV: "production",
        SANGFOR_PROCESS_PROFILE: "local",
      }),
    ).toBe("local");
  });

  it("infers production from NODE_ENV when profile unset", () => {
    expect(resolveProcessProfile({ NODE_ENV: "production" })).toBe(
      "production",
    );
  });

  it("defaults to local", () => {
    expect(resolveProcessProfile({})).toBe("local");
  });
});

describe("local/test profiles", () => {
  it("starts without real external credentials when features are disabled", () => {
    for (const profile of ["local", "test"] as const) {
      const result = validateProcessProfile(
        "web",
        { SANGFOR_PROCESS_PROFILE: profile, NODE_ENV: profile === "test" ? "test" : "development" },
        profile,
      );
      expect(result.ok).toBe(true);
      expect(result.profile).toBe(profile);
    }
  });

  it("requires feature secrets only when the feature is enabled", () => {
    expect(() =>
      validateProcessProfile(
        "web",
        {
          SANGFOR_PROCESS_PROFILE: "local",
          GITHUB_ENABLED: "1",
          // GITHUB_TOKEN missing
        },
        "local",
      ),
    ).toThrow(ProcessProfileError);

    expect(
      validateProcessProfile(
        "web",
        {
          SANGFOR_PROCESS_PROFILE: "local",
          GITHUB_ENABLED: "1",
          GITHUB_TOKEN: "ghp_not_a_real_token_but_present",
        },
        "local",
      ).ok,
    ).toBe(true);
  });

  it("does not require microsoft graph secrets when disabled", () => {
    expect(isFeatureEnabled("microsoft_graph", {})).toBe(false);
    expect(
      validateProcessProfile("api", { SANGFOR_PROCESS_PROFILE: "test" }, "test")
        .ok,
    ).toBe(true);
  });
});

describe("production profile fail-closed", () => {
  it("fails when JWT/required critical keys are missing", () => {
    expect(() =>
      validateProcessProfile(
        "web",
        { NODE_ENV: "production", SANGFOR_PROCESS_PROFILE: "production" },
        "production",
      ),
    ).toThrow(/JWT_SECRET|NEXTAUTH_SECRET|PROCESS_PROFILE/);

    expect(() =>
      validateProcessProfile(
        "api",
        { NODE_ENV: "production", SANGFOR_PROCESS_PROFILE: "production" },
        "production",
      ),
    ).toThrow(ProcessProfileError);
  });

  it("fails on mock auth / bypass / safe-tool off / placeholder secrets", () => {
    expect(() =>
      validateProcessProfile(
        "api",
        productionBase({ AUTH_PROFILE: "local_mock" }),
        "production",
      ),
    ).toThrow(/local_mock/);

    expect(() =>
      validateProcessProfile(
        "api",
        productionBase({ AUTH_BYPASS_ENABLED: "1" }),
        "production",
      ),
    ).toThrow(/AUTH_BYPASS/);

    expect(() =>
      validateProcessProfile(
        "engineer-bridge",
        productionBase({ WHELP99_ENFORCE_SAFE_TOOLS: "false" }),
        "production",
      ),
    ).toThrow(/WHELP99_ENFORCE_SAFE_TOOLS/);

    expect(() =>
      validateProcessProfile(
        "api",
        productionBase({ SANGFOR_API_KEY: "placeholder" }),
        "production",
      ),
    ).toThrow(/placeholder/);
  });

  it("accepts a complete production api env", () => {
    const result = assertProcessProfile("api", productionBase(), "production");
    expect(result.ok).toBe(true);
  });

  it("mirrors U002 productionAuthConfigurationIssues predicates", () => {
    const issues = productionAuthConfigurationIssues({
      NODE_ENV: "production",
      AUTH_BYPASS_ENABLED: "true",
      WHELP99_ENFORCE_SAFE_TOOLS: "false",
    });
    expect(issues).toContain("AUTH_BYPASS_ENABLED");
    expect(issues).toContain("WHELP99_ENFORCE_SAFE_TOOLS");
    expect(issues).toContain("SANGFOR_API_KEY");
    expect(issues).toContain("SANGFOR_OPERATOR_PRINCIPAL_ID");
  });

  it("mirrors U002 workflow assertSafeWorkflowConfiguration predicates", () => {
    const issues = workflowProductionConfigurationIssues({
      AUTH_BYPASS_ENABLED: "1",
      WHELP99_ENFORCE_SAFE_TOOLS: "0",
    });
    expect(issues).toContain("AUTH_BYPASS_ENABLED");
    expect(issues).toContain("WHELP99_ENFORCE_SAFE_TOOLS");
    expect(issues).toContain("SANGFOR_API_KEY");
    expect(issues).toContain("MCP_API_KEY");
  });

  it("requires both workflow API keys in production", () => {
    expect(() =>
      validateProcessProfile(
        "workflow-operator",
        productionBase({ MCP_API_KEY: "" }),
        "production",
      ),
    ).toThrow(/MCP_API_KEY/);
  });
});

describe("profile matrix", () => {
  it("enumerates all local|test|production × processes", () => {
    const matrix = buildProfileMatrix();
    expect(PROCESS_PROFILES).toEqual(["local", "test", "production"]);
    expect(matrix.length).toBe(PROCESS_PROFILES.length * 6);
    expect(
      matrix.every((row) => row.requiresExternalSecretsWhenDisabled === false),
    ).toBe(true);
  });
});

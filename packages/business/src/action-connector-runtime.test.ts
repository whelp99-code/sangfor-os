import { afterEach, describe, expect, it } from "vitest";

import {
  FORBIDDEN_ACTION_KEYS,
  getActionDefinition,
  isForbiddenActionKey,
  listActionDefinitions,
  resolveConnectorRuntimeState,
  validateAction,
  validateActionDefinition,
} from "./action-connector-runtime";

const savedGithubToken = process.env.GITHUB_TOKEN;
const savedStagingMode = process.env.CONNECTOR_STAGING_MODE;

afterEach(() => {
  if (savedGithubToken === undefined) delete process.env.GITHUB_TOKEN;
  else process.env.GITHUB_TOKEN = savedGithubToken;
  if (savedStagingMode === undefined) delete process.env.CONNECTOR_STAGING_MODE;
  else process.env.CONNECTOR_STAGING_MODE = savedStagingMode;
});

describe("action-connector-runtime metadata", () => {
  it("validates registered action definitions", () => {
    const action = getActionDefinition("phase13.run");
    expect(action).not.toBeNull();
    const result = validateActionDefinition(action);
    expect(result.valid).toBe(true);
    expect(result.action?.actionKey).toBe("phase13.run");
  });

  it("returns warning when github credentials are missing", () => {
    delete process.env.GITHUB_TOKEN;
    process.env.CONNECTOR_STAGING_MODE = "mock";
    const result = validateAction("github.sync-pr");
    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => w.includes("GITHUB_TOKEN"))).toBe(true);
    expect(result.connector?.effectiveMode).toBe("mock");
  });

  it("keeps forbidden mail actions absent from catalog", () => {
    for (const key of FORBIDDEN_ACTION_KEYS) {
      expect(isForbiddenActionKey(key)).toBe(true);
      expect(getActionDefinition(key)).toBeNull();
    }
    expect(listActionDefinitions().every((a) => !FORBIDDEN_ACTION_KEYS.has(a.actionKey))).toBe(true);
  });

  it("rejects forbidden mail actions on validate", () => {
    const result = validateAction("mail.send");
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("action_forbidden");
  });

  it("blocks sync actions when connector is read_only", () => {
    process.env.GITHUB_TOKEN = "test-token";
    process.env.CONNECTOR_STAGING_MODE = "real";
    const result = validateAction("github.sync-pr", {
      registryStatusByConnector: { github: "read_only" },
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("read_only_connector_blocks_action");
  });

  it("allows mail.read on read_only mail-intelligence connector", () => {
    const result = validateAction("mail.read");
    expect(result.valid).toBe(true);
    expect(result.connector?.effectiveMode).toMatch(/mock|read_only/);
  });

  it("works in mock mode for CI", () => {
    delete process.env.GITHUB_TOKEN;
    process.env.CONNECTOR_STAGING_MODE = "mock";
    const github = resolveConnectorRuntimeState("github");
    const phase13 = validateAction("phase13.run");
    expect(github?.effectiveMode).toBe("mock");
    expect(phase13.valid).toBe(true);
    expect(phase13.warnings.some((w) => w.includes("mock mode"))).toBe(true);
  });
});

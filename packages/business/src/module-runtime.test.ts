import { describe, expect, it } from "vitest";

import {
  convertManifestToRegistryPatch,
  convertRegistryRowsToManifest,
  moduleManifestSchema,
  validateModuleManifest,
  validateModuleRuntime,
} from "./module-runtime";

describe("module-runtime manifest validation", () => {
  it("validates deterministic manifest shape", () => {
    const manifest = moduleManifestSchema.parse({
      moduleKey: "module-runtime",
      displayName: "Module Runtime",
      version: "1.0.0",
      status: "active",
      dependencyKeys: ["registry-admin"],
      blocks: [{ blockKey: "module-runtime.summary", displayName: "Summary" }],
      nodes: [{ nodeKey: "validate-module-runtime", nodeType: "validation" }],
    });
    expect(manifest.moduleKey).toBe("module-runtime");
    expect(manifest.attribution.sourceLicense).toContain("MIT-compatible");
  });

  it("returns validation errors for invalid manifest", () => {
    const result = validateModuleManifest({
      moduleKey: "x",
      displayName: "",
      version: "1",
    });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});

describe("module-runtime registry conversion", () => {
  it("converts registry rows into manifest", () => {
    const manifest = convertRegistryRowsToManifest({
      module: {
        moduleKey: "opportunity",
        displayName: "Opportunity Module",
        version: "0.1.0",
        status: "active",
        dependencyJson: ["customer", "task"],
      },
      blocks: [
        {
          blockKey: "opportunity.pipeline-board",
          displayName: "Pipeline Board",
          configJson: { queryKey: "opportunity_pipeline" },
        },
      ],
      nodes: [{ nodeKey: "validate-lint-test-build", nodeType: "validation" }],
    });
    expect(manifest.moduleKey).toBe("opportunity");
    expect(manifest.dependencyKeys).toEqual(["customer", "task"]);
    expect(manifest.blocks[0]?.queryKey).toBe("opportunity_pipeline");
  });

  it("converts manifest into registry patch payload", () => {
    const patch = convertManifestToRegistryPatch({
      moduleKey: "knowledge",
      displayName: "Knowledge Module",
      version: "0.2.0",
      status: "experimental",
      dependencyKeys: [],
      blocks: [{ blockKey: "knowledge.search", displayName: "Search" }],
      nodes: [{ nodeKey: "knowledge-validate", nodeType: "validation" }],
      attribution: {
        inspiredBy: "activepieces-community-manifest-pattern",
        sourceLicense: "MIT-compatible pattern only",
        notes: "No AGPL/SUL/source-available code copied.",
      },
    });
    expect(patch.module.moduleKey).toBe("knowledge");
    expect(patch.blocks[0]?.moduleKey).toBe("knowledge");
    expect(patch.nodes[0]?.nodeType).toBe("validation");
  });
});

describe("module-runtime validation coverage", () => {
  it("detects missing/disabled dependencies", () => {
    const manifest = moduleManifestSchema.parse({
      moduleKey: "proposal",
      displayName: "Proposal",
      version: "1.0.0",
      status: "active",
      dependencyKeys: ["customer", "partner"],
      blocks: [],
      nodes: [],
    });

    const result = validateModuleRuntime(manifest, {
      dependencyStatusByKey: { customer: "disabled" },
      actionKeys: [],
      routeSmokeTargets: ["/api/modules/proposal"],
    });

    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain("disabled_dependency");
    expect(result.issues.map((issue) => issue.code)).toContain("missing_dependency");
  });

  it("flags forbidden action and missing route-smoke target", () => {
    const manifest = moduleManifestSchema.parse({
      moduleKey: "portal",
      displayName: "Portal",
      version: "1.0.0",
      status: "active",
      dependencyKeys: [],
      blocks: [],
      nodes: [],
    });

    const result = validateModuleRuntime(manifest, {
      dependencyStatusByKey: {},
      actionKeys: ["mail.send"],
      routeSmokeTargets: [],
    });

    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain("forbidden_action");
    expect(result.issues.map((issue) => issue.code)).toContain("route_smoke_target_missing");
  });

  it("flags missing credential in read_only/real connector mode", () => {
    delete process.env.GITHUB_TOKEN;
    process.env.CONNECTOR_STAGING_MODE = "mock";
    const manifest = moduleManifestSchema.parse({
      moduleKey: "development",
      displayName: "Development",
      version: "1.0.0",
      status: "active",
      dependencyKeys: [],
      blocks: [],
      nodes: [],
    });

    const result = validateModuleRuntime(manifest, {
      dependencyStatusByKey: {},
      actionKeys: ["github.sync-pr"],
      routeSmokeTargets: ["/api/modules/development"],
      connectorStatusByKey: { github: "read_only" },
    });

    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain("missing_credential");
  });
});

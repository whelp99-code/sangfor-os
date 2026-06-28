import { describe, it, expect } from "vitest";
import {
  resolveDomainModelGated,
  buildGatedModelMap,
  modelAllowsClass,
  ModelPolicyError,
  DOMAIN_DATA_CLASS,
  type ModelPolicyEntry,
} from "./domain-model-policy";

const registry: ModelPolicyEntry[] = [
  { providerID: "openai", modelID: "gpt-5.4-mini-fast", allowedDataClassification: ["public", "internal"], isActive: true },
  { providerID: "openai", modelID: "gpt-5.4", allowedDataClassification: ["public", "internal", "confidential", "restricted"], isActive: true },
  { providerID: "openai", modelID: "gpt-legacy", allowedDataClassification: ["public", "internal", "restricted"], isActive: false },
];

describe("modelAllowsClass", () => {
  it("requires explicit inclusion of the data class", () => {
    expect(modelAllowsClass(["public", "internal"], "internal")).toBe(true);
    expect(modelAllowsClass(["public", "internal"], "restricted")).toBe(false);
  });
});

describe("resolveDomainModelGated", () => {
  it("routes a restricted domain (cfo) only to a model that allows restricted", () => {
    const m = resolveDomainModelGated("cfo", { registry });
    expect(m.modelID).toBe("gpt-5.4"); // mini-fast doesn't allow restricted; legacy inactive
  });

  it("allows an internal domain (marketing) to use a lighter model", () => {
    const m = resolveDomainModelGated("marketing", { registry });
    expect(m.modelID).toBe("gpt-5.4-mini-fast"); // first eligible
  });

  it("honors an override when it is permitted for the data class", () => {
    const m = resolveDomainModelGated("cfo", {
      registry,
      overrides: { cfo: { providerID: "openai", modelID: "gpt-5.4" } },
    });
    expect(m.modelID).toBe("gpt-5.4");
  });

  it("REJECTS an override that is not permitted (no silent downgrade)", () => {
    expect(() =>
      resolveDomainModelGated("cfo", {
        registry,
        overrides: { cfo: { providerID: "openai", modelID: "gpt-5.4-mini-fast" } },
      }),
    ).toThrow(ModelPolicyError);
  });

  it("ignores inactive models", () => {
    // only the inactive legacy allows restricted besides gpt-5.4 → must pick gpt-5.4, never legacy
    const m = resolveDomainModelGated("engineer", { registry });
    expect(m.modelID).toBe("gpt-5.4");
  });

  it("throws when no active model covers the required class", () => {
    const onlyLight: ModelPolicyEntry[] = [
      { providerID: "openai", modelID: "mini", allowedDataClassification: ["public", "internal"], isActive: true },
    ];
    expect(() => resolveDomainModelGated("cfo", { registry: onlyLight })).toThrow(/no active model permitted/);
  });

  it("respects a domainDataClass override", () => {
    // force marketing to restricted → mini-fast no longer eligible
    const m = resolveDomainModelGated("marketing", { registry, domainDataClass: { marketing: "restricted" } });
    expect(m.modelID).toBe("gpt-5.4");
  });
});

describe("buildGatedModelMap", () => {
  it("maps every GTM domain, sensitive ones to the restricted-capable model", () => {
    const map = buildGatedModelMap({ registry });
    expect(map.marketing?.modelID).toBe("gpt-5.4-mini-fast");
    expect(map.cfo?.modelID).toBe("gpt-5.4");
    expect(map.engineer?.modelID).toBe("gpt-5.4");
    expect(DOMAIN_DATA_CLASS.cfo).toBe("restricted");
  });
});

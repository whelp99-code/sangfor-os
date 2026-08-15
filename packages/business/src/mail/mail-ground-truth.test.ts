import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  buildGroundTruthImportPlan,
  buildGroundTruthReclassificationPlan,
  parseMailGroundTruthManifest,
  type GroundTruthCandidate,
} from "./mail-ground-truth";

function manifestWithRelationships(
  relationships: readonly Record<string, unknown>[],
) {
  return parseMailGroundTruthManifest({
    schemaVersion: 1,
    manifestId: "blro-2026-08-12-v1",
    projectSlug: "demo-project",
    sources: [
      {
        artifactId: "sales-invoice-1",
        fileName: "sales.xlsx",
        sha256: "a".repeat(64),
        sourceType: "sales_tax_invoice",
      },
    ],
    entities: [
      {
        entityKey: "gsitm",
        canonicalName: "GSITM",
        aliases: ["지에스아이티엠"],
        domain: "gsitm.com",
        reviewStatus: "approved",
      },
      {
        entityKey: "gs-enc",
        canonicalName: "GS건설",
        aliases: ["GS E&C"],
        reviewStatus: "approved",
      },
    ],
    relationships,
  });
}

const channelRelationship = {
  relationshipKey: "gsenc-vdi:gsitm:channel",
  businessProject: "GS건설 VDI 리뉴얼",
  subjectEntityKey: "gsitm",
  role: "channel_partner",
  endCustomerEntityKey: "gs-enc",
  product: "VDI",
  lifecycle: "completed",
  evidenceTier: "A",
  confidence: 95,
  reviewStatus: "approved",
  sourceArtifactIds: ["sales-invoice-1"],
} as const;

describe("buildGroundTruthImportPlan", () => {
  it("plans an active project-role memory when approved evidence is new", () => {
    // Given
    const manifest = manifestWithRelationships([channelRelationship]);

    // When
    const plan = buildGroundTruthImportPlan(manifest, []);

    // Then
    expect(plan.create).toHaveLength(1);
    expect(plan.create[0]).toMatchObject({
      key: "blro-2026-08-12-v1:gsenc-vdi:gsitm:channel",
      source: "ground_truth_manifest:blro-2026-08-12-v1",
      confidence: 95,
      status: "active",
    });
    expect(plan.create[0]?.valueJson).toMatchObject({
      subject: { canonicalName: "GSITM" },
      endCustomer: { canonicalName: "GS건설" },
      evidence: [{ artifactId: "sales-invoice-1", sha256: "a".repeat(64) }],
    });
  });
});

describe("buildGroundTruthReclassificationPlan", () => {
  it("changes a customer candidate to partner for one approved channel role", () => {
    // Given
    const manifest = manifestWithRelationships([channelRelationship]);

    // When
    const plan = buildGroundTruthReclassificationPlan(
      [
        {
          id: "candidate-1",
          candidateType: "customer",
          title: "Customer: 지에스아이티엠",
          summary: "GS건설 VDI 리뉴얼 견적",
        },
      ],
      manifest,
    );

    // Then
    expect(plan.changes).toEqual([
      {
        id: "candidate-1",
        title: "Customer: 지에스아이티엠",
        from: "customer",
        to: "partner",
        entityKey: "gsitm",
        relationshipKeys: ["gsenc-vdi:gsitm:channel"],
        evidence: [
          {
            relationshipKey: "gsenc-vdi:gsitm:channel",
            businessProject: "GS건설 VDI 리뉴얼",
            role: "channel_partner",
            evidenceTier: "A",
            sourceArtifactIds: ["sales-invoice-1"],
          },
        ],
      },
    ]);
    expect(plan.writeOperationsPrevented).toBe(1);
  });

  it("requires human review when approved projects give one entity conflicting roles", () => {
    // Given
    const manifest = manifestWithRelationships([
      channelRelationship,
      {
        ...channelRelationship,
        relationshipKey: "gsitm-direct:gsitm:customer",
        businessProject: "GSITM 직접 구매",
        role: "direct_customer",
        endCustomerEntityKey: undefined,
      },
    ]);

    // When
    const plan = buildGroundTruthReclassificationPlan(
      [
        {
          id: "candidate-1",
          candidateType: "customer",
          title: "Customer: GSITM",
          summary: "회사 소개",
        },
      ],
      manifest,
    );

    // Then
    expect(plan.changes).toHaveLength(0);
    expect(plan.humanReview).toEqual([
      {
        id: "candidate-1",
        entityKey: "gsitm",
        reason: "conflicting_project_roles",
      },
    ]);
  });

  it("does not use proposed evidence to change a candidate", () => {
    // Given
    const manifest = manifestWithRelationships([
      { ...channelRelationship, reviewStatus: "proposed" },
    ]);

    // When
    const plan = buildGroundTruthReclassificationPlan(
      [
        {
          id: "candidate-1",
          candidateType: "customer",
          title: "Customer: GSITM",
          summary: "GS건설 VDI 리뉴얼 견적",
        },
      ],
      manifest,
    );

    // Then
    expect(plan.changes).toHaveLength(0);
    expect(plan.unchanged).toEqual(["candidate-1"]);
  });

  it("does not promote system-sender candidates from a coincidental entity name", () => {
    // Given
    const manifest = manifestWithRelationships([channelRelationship]);

    // When
    const plan = buildGroundTruthReclassificationPlan(
      [
        {
          id: "candidate-1",
          candidateType: "customer",
          title: "Customer: GSITM",
          summary: "세금계산서 알림",
          sourceSender: "notice@bill36524.com",
        },
      ],
      manifest,
    );

    // Then
    expect(plan.changes).toHaveLength(0);
    expect(plan.unchanged).toEqual(["candidate-1"]);
  });

  it("uses the project named in mail text to resolve multi-role entities", () => {
    // Given
    const manifest = manifestWithRelationships([
      channelRelationship,
      {
        ...channelRelationship,
        relationshipKey: "gsitm-direct:gsitm:customer",
        businessProject: "GSITM 직접 구매",
        role: "direct_customer",
        endCustomerEntityKey: undefined,
      },
    ]);

    // When
    const plan = buildGroundTruthReclassificationPlan(
      [
        {
          id: "candidate-1",
          candidateType: "customer",
          title: "Customer: GSITM",
          summary: "GS건설 VDI 리뉴얼 견적",
        },
      ],
      manifest,
    );

    // Then
    expect(plan.changes).toEqual([
      {
        id: "candidate-1",
        title: "Customer: GSITM",
        from: "customer",
        to: "partner",
        entityKey: "gsitm",
        relationshipKeys: ["gsenc-vdi:gsitm:channel"],
        evidence: [
          {
            relationshipKey: "gsenc-vdi:gsitm:channel",
            businessProject: "GS건설 VDI 리뉴얼",
            role: "channel_partner",
            evidenceTier: "A",
            sourceArtifactIds: ["sales-invoice-1"],
          },
        ],
      },
    ]);
    expect(plan.humanReview).toHaveLength(0);
  });
});

describe("parseMailGroundTruthManifest", () => {
  it("parses the checked-in BLRO approved manifest", () => {
    // Given
    const manifestUrl = new URL(
      "../../../../docs/05_DATA_AI/BLRO_Mail_Classification_Ground_Truth_2026-08-12.json",
      import.meta.url,
    );
    const input: unknown = JSON.parse(readFileSync(manifestUrl, "utf8"));

    // When
    const manifest = parseMailGroundTruthManifest(input);

    // Then
    expect(manifest.manifestId).toBe("blro-mail-ground-truth-2026-08-12-v1");
    expect(manifest.sources).toHaveLength(14);
    expect(manifest.relationships.length).toBeGreaterThan(0);
    expect(
      manifest.relationships.every(
        (relationship) => relationship.reviewStatus === "approved",
      ),
    ).toBe(true);
  });

  it("keeps the documented fixture dry-run result reproducible", () => {
    // Given
    const manifest = parseMailGroundTruthManifest(
      JSON.parse(
        readFileSync(
          new URL(
            "../../../../docs/05_DATA_AI/BLRO_Mail_Classification_Ground_Truth_2026-08-12.json",
            import.meta.url,
          ),
          "utf8",
        ),
      ),
    );
    const fixture = JSON.parse(
      readFileSync(
        new URL(
          "../../scripts/__fixtures__/mail-ground-truth-candidates.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ) as { readonly candidates: readonly GroundTruthCandidate[] };

    // When
    const plan = buildGroundTruthReclassificationPlan(
      fixture.candidates,
      manifest,
    );

    // Then
    expect(fixture.candidates).toHaveLength(3);
    expect(plan.changes).toHaveLength(2);
    expect(plan.writeOperationsPrevented).toBe(2);
  });

  it("rejects evidence without a content hash", () => {
    // Given
    const input = {
      schemaVersion: 1,
      manifestId: "bad",
      projectSlug: "demo-project",
      sources: [
        {
          artifactId: "missing-hash",
          fileName: "unknown.xlsx",
          sourceType: "sales_tax_invoice",
        },
      ],
      entities: [],
      relationships: [],
    };

    // When / Then
    expect(() => parseMailGroundTruthManifest(input)).toThrow();
  });

  it("rejects relationships whose evidence is absent from the manifest", () => {
    // Given
    const relationship = {
      ...channelRelationship,
      sourceArtifactIds: ["missing-evidence"],
    };

    // When / Then
    expect(() => manifestWithRelationships([relationship])).toThrow(
      /references unknown evidence/u,
    );
  });
});

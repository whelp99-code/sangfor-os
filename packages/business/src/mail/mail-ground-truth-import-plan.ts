import type {
  ExistingProjectRoleMemory,
  GroundTruthImportPlan,
  MailGroundTruthManifest,
} from "./mail-ground-truth-contract";

function memoryForRelationship(
  manifest: MailGroundTruthManifest,
  relationship: MailGroundTruthManifest["relationships"][number],
): ExistingProjectRoleMemory | null {
  if (relationship.reviewStatus === "excluded") return null;
  const subject = manifest.entities.find(
    (entity) => entity.entityKey === relationship.subjectEntityKey,
  );
  if (!subject) return null;
  const findEntity = (key: string | undefined) =>
    key
      ? manifest.entities.find((entity) => entity.entityKey === key)
      : undefined;
  const sourceIds = new Set(relationship.sourceArtifactIds);
  const evidence = manifest.sources
    .filter((source) => sourceIds.has(source.artifactId))
    .map((source) => ({
      artifactId: source.artifactId,
      fileName: source.fileName,
      sha256: source.sha256,
      sourceType: source.sourceType,
    }));

  return {
    key: `${manifest.manifestId}:${relationship.relationshipKey}`,
    label: `${subject.canonicalName} · ${relationship.businessProject} · ${relationship.role}`,
    valueJson: {
      schemaVersion: 1,
      manifestId: manifest.manifestId,
      businessProject: relationship.businessProject,
      subject,
      role: relationship.role,
      counterparty: findEntity(relationship.counterpartyEntityKey),
      endCustomer: findEntity(relationship.endCustomerEntityKey),
      product: relationship.product,
      lifecycle: relationship.lifecycle,
      evidenceTier: relationship.evidenceTier,
      reviewStatus: relationship.reviewStatus,
      evidence,
    },
    source: `ground_truth_manifest:${manifest.manifestId}`,
    confidence: relationship.confidence,
    status: relationship.reviewStatus === "approved" ? "active" : "proposed",
  };
}

function stableValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableValue).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableValue(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function buildGroundTruthImportPlan(
  manifest: MailGroundTruthManifest,
  existing: readonly ExistingProjectRoleMemory[],
): GroundTruthImportPlan {
  const existingByKey = new Map(existing.map((memory) => [memory.key, memory]));
  const create: ExistingProjectRoleMemory[] = [];
  const update: ExistingProjectRoleMemory[] = [];
  const unchanged: ExistingProjectRoleMemory[] = [];

  for (const relationship of manifest.relationships) {
    const desired = memoryForRelationship(manifest, relationship);
    if (!desired) continue;
    const current = existingByKey.get(desired.key);
    if (!current) {
      create.push(desired);
    } else if (stableValue(current) === stableValue(desired)) {
      unchanged.push(desired);
    } else {
      update.push(desired);
    }
  }
  return { create, update, unchanged };
}

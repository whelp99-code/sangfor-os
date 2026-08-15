import {
  mailGroundTruthManifestSchema,
  type GroundTruthCandidate,
  type GroundTruthReclassificationPlan,
  type MailGroundTruthManifest,
} from "./mail-ground-truth-contract";

export { buildGroundTruthImportPlan } from "./mail-ground-truth-import-plan";
export type {
  ExistingProjectRoleMemory,
  GroundTruthCandidate,
  GroundTruthImportPlan,
  GroundTruthReclassificationPlan,
  MailGroundTruthManifest,
} from "./mail-ground-truth-contract";

const SYSTEM_SENDER_DOMAINS = new Set([
  "bill36524.com",
  "crew.you",
  "hometax.go.kr",
]);

function senderDomain(value: string | null | undefined): string | null {
  if (!value) return null;
  const emailDomain = value.match(/@([a-z0-9.-]+\.[a-z]{2,})/iu)?.[1];
  return (emailDomain ?? value).trim().toLowerCase();
}

function normalizeEntity(value: string): string {
  return value
    .toLowerCase()
    .replace(/^(customer|partner):\s*/u, "")
    .replace(/\(주\)|㈜|주식회사/gu, "")
    .replace(/[^a-z0-9가-힣]/gu, "");
}

function relationshipMatchScore(
  candidate: GroundTruthCandidate,
  relationship: MailGroundTruthManifest["relationships"][number],
  entities: MailGroundTruthManifest["entities"],
): number {
  const text = normalizeEntity(`${candidate.title} ${candidate.summary}`);
  const subject = entities.find(
    (entity) => entity.entityKey === relationship.subjectEntityKey,
  );
  const subjectSignals = new Set(
    [subject?.canonicalName, ...(subject?.aliases ?? [])]
      .filter((value): value is string => Boolean(value))
      .map(normalizeEntity),
  );
  const normalizedProject = [...subjectSignals].reduce(
    (project, signal) => project.replaceAll(signal, ""),
    normalizeEntity(relationship.businessProject),
  );
  const relatedEntityKeys = [
    relationship.counterpartyEntityKey,
    relationship.endCustomerEntityKey,
  ].filter((value): value is string => Boolean(value));
  const entitySignals = entities
    .filter((entity) => relatedEntityKeys.includes(entity.entityKey))
    .flatMap((entity) => [entity.canonicalName, ...entity.aliases])
    .map(normalizeEntity);
  let score = normalizedProject.length >= 2 && text.includes(normalizedProject) ? 4 : 0;
  if (entitySignals.some((signal) => signal.length > 0 && text.includes(signal))) score += 3;
  const product = relationship.product ? normalizeEntity(relationship.product) : "";
  if (product.length >= 2 && text.includes(product)) score += 1;
  return score;
}

export function parseMailGroundTruthManifest(input: unknown): MailGroundTruthManifest {
  return mailGroundTruthManifestSchema.parse(input);
}

export function buildGroundTruthReclassificationPlan(
  candidates: readonly GroundTruthCandidate[],
  manifest: MailGroundTruthManifest,
): GroundTruthReclassificationPlan {
  const approved = manifest.relationships.filter(
    (relationship) => relationship.reviewStatus === "approved",
  );
  const aliases = new Map<string, string>();
  for (const entity of manifest.entities) {
    aliases.set(normalizeEntity(entity.canonicalName), entity.entityKey);
    for (const alias of entity.aliases) aliases.set(normalizeEntity(alias), entity.entityKey);
  }

  const changes: GroundTruthReclassificationPlan["changes"][number][] = [];
  const humanReview: GroundTruthReclassificationPlan["humanReview"][number][] = [];
  const unchanged: string[] = [];

  for (const candidate of candidates) {
    if (candidate.candidateType !== "customer" && candidate.candidateType !== "partner") {
      unchanged.push(candidate.id);
      continue;
    }
    const domain = senderDomain(candidate.sourceSender);
    if (
      domain &&
      [...SYSTEM_SENDER_DOMAINS].some(
        (root) => domain === root || domain.endsWith(`.${root}`),
      )
    ) {
      unchanged.push(candidate.id);
      continue;
    }
    const entityKey = aliases.get(normalizeEntity(candidate.title));
    if (!entityKey) {
      unchanged.push(candidate.id);
      continue;
    }
    const allEntityRelationships = approved.filter(
      (relationship) => relationship.subjectEntityKey === entityKey,
    );
    const scoredRelationships = allEntityRelationships.map((relationship) => ({
      relationship,
      score: relationshipMatchScore(candidate, relationship, manifest.entities),
    }));
    const bestScore = Math.max(0, ...scoredRelationships.map((entry) => entry.score));
    const contextualRelationships = scoredRelationships
      .filter((entry) => entry.score === bestScore && entry.score > 0)
      .map((entry) => entry.relationship);
    const entityRelationships =
      contextualRelationships.length > 0 ? contextualRelationships : allEntityRelationships;
    const targetTypes = new Set<"customer" | "partner">();
    for (const relationship of entityRelationships) {
      if (
        relationship.role === "channel_partner" ||
        relationship.role === "supplier" ||
        relationship.role === "distributor"
      ) {
        targetTypes.add("partner");
      }
      if (
        relationship.role === "end_customer" ||
        relationship.role === "direct_customer"
      ) {
        targetTypes.add("customer");
      }
    }
    if (targetTypes.size !== 1) {
      if (targetTypes.size > 1) {
        humanReview.push({
          id: candidate.id,
          entityKey,
          reason: "conflicting_project_roles",
        });
      } else {
        unchanged.push(candidate.id);
      }
      continue;
    }
    const targetType = [...targetTypes][0];
    if (!targetType || targetType === candidate.candidateType) {
      unchanged.push(candidate.id);
      continue;
    }
    changes.push({
      id: candidate.id,
      title: candidate.title,
      from: candidate.candidateType,
      to: targetType,
      entityKey,
      relationshipKeys: entityRelationships.map(
        (relationship) => relationship.relationshipKey,
      ),
      evidence: entityRelationships.map((relationship) => ({
        relationshipKey: relationship.relationshipKey,
        businessProject: relationship.businessProject,
        role: relationship.role,
        evidenceTier: relationship.evidenceTier,
        sourceArtifactIds: relationship.sourceArtifactIds,
      })),
    });
  }

  return {
    changes,
    humanReview,
    unchanged,
    writeOperationsPrevented: changes.length,
  };
}

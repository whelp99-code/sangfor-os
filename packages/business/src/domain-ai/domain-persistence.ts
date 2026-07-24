import type { GtmDomain } from "@sangfor/shared/modes";

import type { DomainArtifact, DomainCase } from "./domain-agent-runtime";

/**
 * Domain pipelines do not carry a verified session-derived U016 AuthContext. U043 therefore
 * removes their former Customer/Opportunity upserts and returns a review receipt that points at
 * the already-persisted draft artifact. An authenticated CRM command can promote that draft later.
 */
export interface DomainPersistInput {
  domain: GtmDomain;
  case: DomainCase;
  artifact: DomainArtifact;
  projectSlug?: string;
}

export interface PersistedRecord {
  entity: string;
  id: string;
}

export interface DomainPersistResult {
  domain: GtmDomain;
  persisted: PersistedRecord[];
  skipped?: string;
  reviewRequired?: true;
  authenticatedApiPath?: string;
}

export type DomainPersister = (input: DomainPersistInput) => Promise<DomainPersistResult>;

/**
 * Kept only as a source-compatible dependency shape for callers that inject test doubles. No
 * database method is invoked because an injected Prisma client is not an authority context.
 */
export interface PersistencePrisma {
  readonly [model: string]: unknown;
}

export interface DomainPersisterDeps {
  prisma?: PersistencePrisma;
  resolveProjectId?: (slug?: string) => Promise<string>;
}

export function createDomainPersister(_deps: DomainPersisterDeps = {}): DomainPersister {
  return async ({ domain, case: domainCase, artifact }) => ({
    domain,
    persisted: [{
      entity: "DomainArtifactReviewDraft",
      id: `domain-review:${domain}:${domainCase.id}:${artifact.produces}`,
    }],
    skipped: "authenticated_crm_context_required",
    reviewRequired: true,
    authenticatedApiPath: "/api/opportunities",
  });
}

export function createDefaultDomainPersister(): DomainPersister {
  return createDomainPersister();
}

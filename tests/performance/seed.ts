/**
 * U075 — Deterministic Performance Corpus Seed
 *
 * Seeds exactly: 100 customers, 1000 opportunities, 10000 ArtifactVersions,
 * one catalog/quote set, one ACTIVE M6 workflow, canonical BusinessRole users,
 * one archived sentinel, one foreign-scope sentinel per queried shape.
 */

export type CorpusConfig = {
  customers: number;
  opportunities: number;
  artifactVersions: number;
  workflows: number;
};

export const DEFAULT_CORPUS: CorpusConfig = {
  customers: 100,
  opportunities: 1000,
  artifactVersions: 10000,
  workflows: 1,
};

export function corpusReceipt(config: CorpusConfig): Record<string, unknown> {
  return {
    version: "v1",
    customers: config.customers,
    opportunities: config.opportunities,
    artifactVersions: config.artifactVersions,
    workflows: config.workflows,
    keysetOrdering: "updated_at DESC, id DESC",
    defaultPageSize: 50,
    maxPageSize: 100,
    sentinels: { archived: 1, foreignScope: 1 },
  };
}

import { prisma } from "@sangfor/db";
import type { GtmDomain } from "@sangfor/shared/modes";
import { loadDomainMemories, type DomainMemoryRecord, type RecallQuery } from "../src/domain-ai/domain-memory";
import { recallHybrid } from "../src/domain-ai/domain-embedding";
import { embeddingTextFor } from "../src/domain-ai/domain-embedder";
import { resolveEmbedder, describeEmbedder } from "../src/domain-ai/domain-embedder-openai";
import { resolveDefaultProjectSlug } from "../src/infrastructure/default-project";

const TOP_K = 5;

function tagOverlap(a: string[], b: string[]): boolean {
  const set = new Set(a);
  return b.some((t) => set.has(t));
}

function relevantPeers(query: DomainMemoryRecord, pool: DomainMemoryRecord[]): DomainMemoryRecord[] {
  return pool.filter((r) => r !== query && r.status === "active" && tagOverlap(query.tags, r.tags));
}

function hitAt5(retrieved: DomainMemoryRecord[], relevant: DomainMemoryRecord[]): boolean {
  const relevantKeys = new Set(relevant.map((r) => r.key));
  return retrieved.some((r) => relevantKeys.has(r.key));
}

async function evalDomain(domain: GtmDomain, projectSlug: string) {
  const embed = resolveEmbedder();
  const memories = await loadDomainMemories(domain, projectSlug);
  let baselineHits = 0;
  let semanticHits = 0;
  let scored = 0;

  for (const q of memories) {
    const relevant = relevantPeers(q, memories);
    if (relevant.length === 0) continue;
    scored++;

    const candidates = memories.filter((r) => r !== q);
    const query: RecallQuery = { domain, tags: q.tags };

    const baseline = recallHybrid(query, null, candidates, TOP_K);
    if (hitAt5(baseline, relevant)) baselineHits++;

    const queryText = embeddingTextFor({ label: q.label, tags: q.tags, summary: "" });
    const queryEmbedding = await embed(queryText);
    const semantic = recallHybrid(query, queryEmbedding, candidates, TOP_K);
    if (hitAt5(semantic, relevant)) semanticHits++;
  }

  return { domain, total: memories.length, scored, baselineHits, semanticHits };
}

async function main() {
  const projectSlug = await resolveDefaultProjectSlug();
  const domainsRaw = await prisma.domainMemory.findMany({ select: { domain: true }, distinct: ["domain"] });
  const domains = domainsRaw.map((d) => d.domain as GtmDomain);

  console.log(`embedder=${describeEmbedder()} projectSlug=${projectSlug} domains=${domains.length}`);
  console.log("");

  const rows = [];
  for (const domain of domains) {
    rows.push(await evalDomain(domain, projectSlug));
  }

  const sum = (pick: (r: (typeof rows)[number]) => number) => rows.reduce((a, r) => a + pick(r), 0);
  const totalScored = sum((r) => r.scored);
  const baseRate = totalScored ? (sum((r) => r.baselineHits) / totalScored) : 0;
  const semRate = totalScored ? (sum((r) => r.semanticHits) / totalScored) : 0;

  console.log("| domain | memories | scored | baseline hit@5 | semantic hit@5 |");
  console.log("|---|---|---|---|---|");
  for (const r of rows) {
    const b = r.scored ? (r.baselineHits / r.scored) : 0;
    const s = r.scored ? (r.semanticHits / r.scored) : 0;
    console.log(`| ${r.domain} | ${r.total} | ${r.scored} | ${(b * 100).toFixed(0)}% (${r.baselineHits}/${r.scored}) | ${(s * 100).toFixed(0)}% (${r.semanticHits}/${r.scored}) |`);
  }
  console.log(`| **ALL** | ${sum((r) => r.total)} | ${totalScored} | **${(baseRate * 100).toFixed(0)}%** | **${(semRate * 100).toFixed(0)}%** |`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("EVAL ERROR:", e);
  process.exit(1);
});

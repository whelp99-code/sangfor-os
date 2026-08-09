/**
 * G001 red-team QA — generation 3 delta (a4d52ef..5dc221d).
 * Attacks the fix: upsertDomainMemory now guards the embedding spread on
 * LENGTH instead of truthiness. Before this fix, `embedding: []` was truthy
 * in JS and WROTE an empty array, wiping a row's accumulated vector on every
 * embedder-down pass. Red-team only: no product source is modified. All
 * seeded rows are cleaned up in afterAll.
 *
 * Attacks covered here (real Postgres, gated CI_INTEGRATION=1 + DATABASE_URL):
 *  - direct-DB empty-vector wipe attack: [] and omitted embedding must both
 *    leave an existing vector untouched; a real vector must still overwrite
 *  - end-to-end wipe attack: two runDomainStage passes on the SAME case key
 *    (working embedder, then throwing embedder) — the second pass must not
 *    clear the vector the first pass wrote
 *  - create-branch sanity: a brand-new key with embedding omitted must still
 *    insert (Prisma @default([])) and load back with an empty embedding array
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@sangfor/db";
import { upsertDomainMemory, loadDomainMemories, resolveDomainProjectId } from "../domain-memory";
import { createHashEmbedder } from "../domain-embedder";
import { runDomainStage, createStubGenerator } from "../domain-agent-runtime";
import type { Embedder } from "../domain-embedding";

const integration = process.env.CI_INTEGRATION === "1" && Boolean(process.env.DATABASE_URL);
const SLUG = "demo-project";
const RUN = `g001rt3${Date.now()}`;
const embedder = createHashEmbedder(256);

describe.skipIf(!integration)("G001 red-team gen3: empty-vector wipe attack (real Postgres)", () => {
  beforeAll(async () => {
    await resolveDomainProjectId(SLUG); // fail fast if the project/DB isn't reachable
  });

  afterAll(async () => {
    await prisma.domainMemory.deleteMany({
      where: {
        OR: [{ key: { startsWith: `${RUN}:` } }, { key: { startsWith: `sales:${RUN}` } }],
      },
    });
    await prisma.domainDecisionLog.deleteMany({ where: { caseRef: { startsWith: RUN } } });
    await prisma.$disconnect();
  });

  it("direct-DB: an explicit empty array does NOT wipe an existing vector; a real vector still overwrites", async () => {
    const key = `${RUN}:wipe-direct`;
    const initialVector = await embedder("initial content for the direct-DB wipe attack");

    await upsertDomainMemory({
      projectSlug: SLUG,
      domain: "sales",
      memoryType: "case",
      key,
      label: "wipe attack row (initial)",
      tags: [`${RUN}-wipe-direct`],
      valueJson: { redTeam: RUN },
      outcome: "approved",
      source: "agent",
      confidence: 90,
      embedding: initialVector,
    });
    let row = await prisma.domainMemory.findFirst({ where: { key } });
    expect(row).not.toBeNull();
    expect(row!.embedding).toHaveLength(256);
    // reference = the DB's OWN round-tripped bytes, not the pre-storage JS array — Postgres
    // float8 re-encodes the tail digit on write, so comparing against the original in-memory
    // vector would produce spurious ~1e-16 diffs unrelated to the wipe-attack behavior under test.
    const storedVector = row!.embedding;

    // attack A: embedding: [] — the exact truthy-empty-array bug this generation fixed
    await upsertDomainMemory({
      projectSlug: SLUG,
      domain: "sales",
      memoryType: "case",
      key,
      label: "wipe attack row (after empty-array attack)",
      tags: [`${RUN}-wipe-direct`],
      valueJson: { redTeam: RUN },
      outcome: "approved",
      source: "agent",
      confidence: 91,
      embedding: [],
    });
    row = await prisma.domainMemory.findFirst({ where: { key } });
    expect(row!.embedding).toEqual(storedVector); // survived — column untouched, identical bytes
    expect(row!.label).toBe("wipe attack row (after empty-array attack)"); // non-embedding fields DID update

    // attack B: embedding omitted entirely (the normal degraded-write shape)
    await upsertDomainMemory({
      projectSlug: SLUG,
      domain: "sales",
      memoryType: "case",
      key,
      label: "wipe attack row (after omitted-embedding attack)",
      tags: [`${RUN}-wipe-direct`],
      valueJson: { redTeam: RUN },
      outcome: "approved",
      source: "agent",
      confidence: 92,
    });
    row = await prisma.domainMemory.findFirst({ where: { key } });
    expect(row!.embedding).toEqual(storedVector); // still survived, column still untouched

    // control: a real non-empty vector must still overwrite — the guard must not become a
    // permanent write-once lock on the embedding column
    const replacementVector = await embedder("replacement content — must overwrite");
    await upsertDomainMemory({
      projectSlug: SLUG,
      domain: "sales",
      memoryType: "case",
      key,
      label: "wipe attack row (final, real overwrite)",
      tags: [`${RUN}-wipe-direct`],
      valueJson: { redTeam: RUN },
      outcome: "approved",
      source: "agent",
      confidence: 93,
      embedding: replacementVector,
    });
    row = await prisma.domainMemory.findFirst({ where: { key } });
    // freshly-written vector vs a freshly-written vector: compare within float8 round-trip
    // tolerance (Postgres re-encodes the tail digit, ~1e-16 relative — see gen1 report findings)
    const maxDeltaVsReplacement = row!.embedding.reduce((m, v, i) => Math.max(m, Math.abs(v - replacementVector[i])), 0);
    expect(maxDeltaVsReplacement).toBeLessThan(1e-12);
    const maxDeltaVsStored = row!.embedding.reduce((m, v, i) => Math.max(m, Math.abs(v - storedVector[i])), 0);
    expect(maxDeltaVsStored).toBeGreaterThan(0.01); // genuinely a different vector, not the old one
  });

  it("end-to-end: a second runDomainStage pass with a throwing embedder does not wipe the vector the first pass wrote", async () => {
    const caseId = `${RUN}-wipe-e2e`;
    const tag = `${RUN}-wipe-e2e-tag`;
    const c = { id: caseId, subject: "wipe e2e probe", tags: [tag] };
    const key = `sales:${caseId}`;

    // pass 1: working embedder — real learning write, real 256-dim vector stored
    await runDomainStage("sales", c, {
      generate: createStubGenerator(),
      embed: embedder,
      projectSlug: SLUG,
    });
    const afterPass1 = await prisma.domainMemory.findFirst({ where: { key } });
    expect(afterPass1).not.toBeNull();
    expect(afterPass1!.embedding).toHaveLength(256);
    const vectorAfterPass1 = afterPass1!.embedding;

    // pass 2: SAME case key, throwing embedder — safeEmbed -> null -> upsert omits embedding.
    // Before this generation's fix, the write path never reached this shape (it always
    // spread `embedding: []`), so this reproduces exactly the field scenario the fix targets.
    const failing = (async () => {
      throw new Error("embedder down (red-team gen3 e2e)");
    }) as Embedder;
    await runDomainStage("sales", c, {
      generate: createStubGenerator(),
      embed: failing,
      projectSlug: SLUG,
    });
    const afterPass2 = await prisma.domainMemory.findFirst({ where: { key } });
    expect(afterPass2).not.toBeNull();
    expect(afterPass2!.embedding).toHaveLength(256); // NOT wiped to []
    expect(afterPass2!.embedding).toEqual(vectorAfterPass1); // identical vector survives
  });

  it("create-branch sanity: a brand-new key with embedding omitted still inserts and loads back empty", async () => {
    const key = `${RUN}:wipe-create-branch`;
    await upsertDomainMemory({
      projectSlug: SLUG,
      domain: "sales",
      memoryType: "case",
      key,
      label: "fresh row, no embedding ever supplied",
      tags: [`${RUN}-create-branch`],
      valueJson: { redTeam: RUN },
      outcome: "approved",
      source: "agent",
      confidence: 80,
      // embedding intentionally omitted — must not throw, must not require a vector
    });

    const row = await prisma.domainMemory.findFirst({ where: { key } });
    expect(row).not.toBeNull();
    expect(row!.embedding).toEqual([]); // Prisma column @default([])

    const loaded = await loadDomainMemories("sales", SLUG);
    const rec = loaded.find((r) => r.key === key);
    expect(rec).toBeDefined();
    expect(rec!.embedding).toEqual([]);
  });
});

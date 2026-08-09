/**
 * G001 red-team QA (integration level) — adversarial verification against the
 * REAL disposable Postgres (sangfor_os_test). Gated: CI_INTEGRATION=1 + DATABASE_URL.
 * Red-team only: no product source is modified. All seeded rows are cleaned up.
 *
 * Attacks covered here:
 *  - dim-mismatch: DB row seeded with a 3-dim embedding keeps FULL tag score
 *    under a 256-dim query through recallSemanticFromDb
 *  - embedder-down: real runDomainStage — tag recall survives, the learning row
 *    is written with an EMPTY embedding (key omitted), warning emitted
 *  - poisoned-row: rejected/human-reverted rows with PERFECT embedding
 *    similarity are not recalled (control row proves the embedding path is live)
 *  - domain-isolation: cfo row with perfect embedding never surfaces for sales
 *  - write-path round trip: embedding stored → round-trips → semantic + degraded
 *    recall both find the row (smoke-embedder-wiring.ts pattern)
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { prisma } from "@sangfor/db";
import { recallSemanticFromDb, hybridScore } from "../domain-embedding";
import {
  scoreDomainMemory,
  loadDomainMemories,
  upsertDomainMemory,
  resolveDomainProjectId,
  type RecallQuery,
} from "../domain-memory";
import { createHashEmbedder, embeddingTextFor } from "../domain-embedder";
import { resolveEmbedder, describeEmbedder } from "../domain-embedder-openai";
import { runDomainStage, createStubGenerator } from "../domain-agent-runtime";
import { recordHumanDecision } from "../project-decision";

// 환경에 키가 남아있어도 오프라인 hash 경로로 고정 — 결정론적 red-team.
vi.stubEnv("OPENAI_API_KEY", "");
vi.stubEnv("EMBEDDING_BASE_URL", "");

const integration = process.env.CI_INTEGRATION === "1" && Boolean(process.env.DATABASE_URL);
const SLUG = "demo-project";
const RUN = `g001rt${Date.now()}`;
const embedder = createHashEmbedder(256);

describe.skipIf(!integration)("G001 red-team integration (real Postgres)", () => {
  let projectId: string;

  beforeAll(async () => {
    projectId = await resolveDomainProjectId(SLUG);
  });

  afterAll(async () => {
    // red-team 잔재 완전 정리 — RUN prefix 로 시드한 행만 삭제.
    await prisma.domainMemory.deleteMany({
      where: {
        OR: [
          { key: { startsWith: `${RUN}:` } },
          { key: { startsWith: `eng:${RUN}` } },
          // runDomainStage 학습 쓰기의 key 패턴: `${domain}:${caseId}` (caseId = `${RUN}-c2`)
          { key: { startsWith: `sales:${RUN}` } },
        ],
      },
    });
    await prisma.domainDecisionLog.deleteMany({
      where: { OR: [{ caseRef: { startsWith: RUN } }, { caseRef: { startsWith: `eng:${RUN}` } }] },
    });
    await prisma.$disconnect();
  });

  async function seed(input: {
    key: string;
    domain: string;
    tags: string[];
    embedding: number[];
    outcome: string;
    label?: string;
  }) {
    await prisma.domainMemory.create({
      data: {
        projectId,
        domain: input.domain,
        memoryType: "case",
        key: input.key,
        label: input.label ?? `red-team ${input.key}`,
        tags: input.tags,
        valueJson: { redTeam: RUN },
        outcome: input.outcome,
        source: "agent",
        confidence: 90,
        status: "active",
        embedding: input.embedding,
      },
    });
  }

  it("resolver: this environment resolves to the offline hash embedder (dim 256)", () => {
    expect(describeEmbedder()).toBe("hash");
  });

  it("dim-mismatch attack: 3-dim DB row keeps FULL tag score under a 256-dim query", async () => {
    const uniqueTag = `${RUN}-dim`;
    await seed({
      key: `${RUN}:dim`,
      domain: "sales",
      tags: [uniqueTag],
      embedding: [0.5, 0.5, 0.7071], // foreign embedder dimension (not 256)
      outcome: "approved",
    });

    const queryText = "dimension mismatch probe";
    const recalled = await recallSemanticFromDb({
      domain: "sales",
      tags: [uniqueTag],
      queryText,
      embed: embedder,
      projectSlug: SLUG,
      topK: 50,
    });
    expect(recalled.map((r) => r.key)).toContain(`${RUN}:dim`);

    // score bookkeeping: exactly the null-embedding (pure tag) score — no blend, no zeroing
    const rows = await loadDomainMemories("sales", SLUG);
    const record = rows.find((r) => r.key === `${RUN}:dim`);
    expect(record).toBeDefined();
    expect(record!.embedding).toHaveLength(3); // round-tripped as stored

    // recallSemanticFromDb unions buildMemoryTags({domain}) into the query tags
    const query: RecallQuery = { domain: "sales", tags: [uniqueTag, "domain:sales"] };
    const qEmbed = await embedder(queryText);
    expect(qEmbed).toHaveLength(256);
    const mismatchScore = hybridScore(query, qEmbed, record!);
    const nullScore = hybridScore(query, null, record!);
    const pureTagScore = scoreDomainMemory(query, record!);
    expect(mismatchScore).toBe(nullScore);
    expect(mismatchScore).toBe(pureTagScore);
    expect(mismatchScore).toBeGreaterThan(0);
  });

  it("embedder-down attack: real runDomainStage degrades recall, writes learning WITHOUT embedding", async () => {
    const uniqueTag = `${RUN}-down`;
    await seed({
      key: `${RUN}:down-prior`,
      domain: "sales",
      // runDomainStage queries [uniqueTag, "domain:sales", "entity:case"] — match all
      // three so this row deterministically outranks any pre-existing sales memories.
      tags: [uniqueTag, "domain:sales", "entity:case"],
      embedding: [],
      outcome: "approved",
      label: "prior case for embedder-down attack",
    });

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const failing = vi.fn(async () => {
      throw new Error("embedder down (red-team injected)");
    });

    const caseId = `${RUN}-c2`;
    const result = await runDomainStage(
      "sales",
      { id: caseId, subject: "embedder down probe", tags: [uniqueTag] },
      {
        generate: createStubGenerator(),
        embed: failing as unknown as import("../domain-embedding").Embedder,
        projectSlug: SLUG,
      },
    );

    // recall survived via tags
    expect(result.recalled.map((r) => r.key)).toContain(`${RUN}:down-prior`);
    // failure evidence logged
    const embedWarns = warn.mock.calls.filter((c) => String(c[0]).includes("[domain-embedder] embed_failed"));
    expect(embedWarns.length).toBeGreaterThanOrEqual(1);
    warn.mockRestore();

    // learning row exists and its embedding column stayed empty (key omitted on write)
    const learned = await prisma.domainMemory.findFirst({
      where: { projectId, domain: "sales", key: `sales:${caseId}` },
    });
    expect(learned).not.toBeNull();
    expect(learned!.embedding).toHaveLength(0);
    expect(learned!.outcome).toBe("approved");
  });

  it("poisoned-row attack: negative outcomes with PERFECT embedding similarity stay suppressed", async () => {
    const uniqueTag = `${RUN}-pois`;
    const queryText = "poisoned probe: firewall renewal discount";
    const perfect = await embedder(queryText); // identical vector → cosine 1.0

    await seed({ key: `${RUN}:pois-rej`, domain: "sales", tags: [uniqueTag], embedding: perfect, outcome: "rejected" });
    await seed({ key: `${RUN}:pois-rev`, domain: "sales", tags: [uniqueTag], embedding: perfect, outcome: "human-reverted" });
    await seed({ key: `${RUN}:pois-ctrl`, domain: "sales", tags: [uniqueTag], embedding: perfect, outcome: "approved" });

    const recalled = await recallSemanticFromDb({
      domain: "sales",
      tags: [uniqueTag],
      queryText,
      embed: embedder,
      projectSlug: SLUG,
      topK: 50,
    });
    const keys = recalled.map((r) => r.key);
    // control proves the embedding path is live (perfect-similarity row IS recalled)
    expect(keys).toContain(`${RUN}:pois-ctrl`);
    expect(keys).not.toContain(`${RUN}:pois-rej`);
    expect(keys).not.toContain(`${RUN}:pois-rev`);
  });

  it("domain-isolation attack: cfo row with perfect embedding never surfaces for sales", async () => {
    const uniqueTag = `${RUN}-iso`;
    const queryText = "isolation probe: cross-domain leak attempt";
    const perfect = await embedder(queryText);

    await seed({ key: `${RUN}:iso-cfo`, domain: "cfo", tags: [uniqueTag], embedding: perfect, outcome: "approved" });
    await seed({ key: `${RUN}:iso-sales`, domain: "sales", tags: [uniqueTag], embedding: perfect, outcome: "approved" });

    const recalled = await recallSemanticFromDb({
      domain: "sales",
      tags: [uniqueTag],
      queryText,
      embed: embedder,
      projectSlug: SLUG,
      topK: 50,
    });
    const keys = recalled.map((r) => r.key);
    expect(keys).toContain(`${RUN}:iso-sales`); // embedding path live for the owning domain
    expect(keys).not.toContain(`${RUN}:iso-cfo`); // cross-domain leak blocked
  });

  it("write-path round trip: embedding stored → round-trips → semantic + degraded recall find it", async () => {
    const key = `${RUN}:smoke`;
    const tags = ["domain:sales", `${RUN}-smoke`];
    const text = embeddingTextFor({
      label: "red-team smoke firewall case",
      tags,
      summary: "g001 write-path round trip",
    });

    // resolveEmbedder() (hash here) produces the stored vector — best-effort path
    const embedding = await resolveEmbedder()(text);
    expect(embedding).toHaveLength(256);

    await upsertDomainMemory({
      projectSlug: SLUG,
      domain: "sales",
      memoryType: "case",
      key,
      label: "red-team smoke firewall case",
      tags,
      valueJson: { redTeam: RUN },
      outcome: "approved",
      source: "agent",
      confidence: 90,
      embedding,
    });

    // round trip: vector survives Float[] storage (float8 column — compare within
    // rounding tolerance, not bit-exact; Postgres float8 re-encodes the tail digit)
    const rows = await loadDomainMemories("sales", SLUG);
    const stored = rows.find((r) => r.key === key);
    expect(stored).toBeDefined();
    expect(stored!.embedding).toHaveLength(embedding.length);
    const maxDelta = stored!.embedding!.reduce(
      (m, v, i) => Math.max(m, Math.abs(v - embedding[i])),
      0,
    );
    expect(maxDelta).toBeLessThan(1e-12);

    // semantic recall finds the row through the real DB hybrid path
    const recalled = await recallSemanticFromDb({
      domain: "sales",
      tags: [`${RUN}-smoke`],
      queryText: "firewall smoke case",
      embed: resolveEmbedder(),
      projectSlug: SLUG,
      topK: 50,
    });
    expect(recalled.map((r) => r.key)).toContain(key);

    // degraded (embedder throwing) recall still finds it via tags
    const degraded = await recallSemanticFromDb({
      domain: "sales",
      tags: [`${RUN}-smoke`],
      queryText: "firewall smoke case",
      embed: async () => {
        throw new Error("embedder down (red-team)");
      },
      projectSlug: SLUG,
      topK: 50,
    });
    expect(degraded.map((r) => r.key)).toContain(key);
  });

  it("recordHumanDecision write path: stores a best-effort embedding without blocking the write", async () => {
    // resolveEmbedder() resolves to hash here (no API key) → best-effort embedding computed.
    // This is acceptance criterion #2's project-decision.ts leg: embedding stored, write succeeds.
    const engId = `${RUN}-hd`;
    const { decisionId } = await recordHumanDecision({
      engagementId: engId,
      domain: "sales",
      outcome: "approved",
      output: { proposalText: "red-team human decision probe" },
      note: `red-team ${RUN}`,
    });
    expect(decisionId).toBeTruthy(); // the write itself is never blocked

    const memKey = `eng:${engId}:sales`;
    const mem = await prisma.domainMemory.findFirst({ where: { key: memKey } });
    expect(mem).not.toBeNull();
    expect(mem!.source).toBe("human");
    expect(mem!.outcome).toBe("approved");
    // best-effort embedding was actually computed + stored (hash → 256 dims)
    expect(mem!.embedding.length).toBe(256);
  });

  it("gen2 injection point: recordHumanDecision with a throwing deps.embed still records the decision and writes memory WITHOUT an embedding", async () => {
    const engId = `${RUN}-hd-inject-fail`;
    const failing = async (): Promise<number[]> => {
      throw new Error("embedder down (red-team gen2 injection)");
    };
    const { decisionId } = await recordHumanDecision(
      {
        engagementId: engId,
        domain: "sales",
        outcome: "approved",
        output: { proposalText: "gen2 injection failure probe" },
        note: `red-team gen2 ${RUN}`,
      },
      { embed: failing },
    );
    expect(decisionId).toBeTruthy(); // write is never blocked by embedder failure

    const memKey = `eng:${engId}:sales`;
    const mem = await prisma.domainMemory.findFirst({ where: { key: memKey } });
    expect(mem).not.toBeNull();
    expect(mem!.source).toBe("human");
    expect(mem!.embedding.length).toBe(0); // embedding column untouched (create default [])
  });

  it("gen2 injection point: recordHumanDecision with a WORKING deps.embed stores that exact vector (not resolveEmbedder()'s default)", async () => {
    const engId = `${RUN}-hd-inject-ok`;
    // distinct dimension (33) from the environment's default hash (256) — proves the
    // injected embedder, not resolveEmbedder(), produced the stored vector.
    const injected = createHashEmbedder(33);
    const { decisionId } = await recordHumanDecision(
      {
        engagementId: engId,
        domain: "sales",
        outcome: "approved",
        output: { proposalText: "gen2 injection success probe" },
        note: `red-team gen2 ${RUN}`,
      },
      { embed: injected },
    );
    expect(decisionId).toBeTruthy();

    const memKey = `eng:${engId}:sales`;
    const mem = await prisma.domainMemory.findFirst({ where: { key: memKey } });
    expect(mem).not.toBeNull();
    expect(mem!.embedding.length).toBe(33); // came from the injected embedder, not the 256-dim default
  });
});

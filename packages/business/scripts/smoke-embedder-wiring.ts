/**
 * 임베더 wiring 실증 — 실 Postgres 에서 domain_memories.embedding 왕복을 확인.
 * 쓰기(best-effort 임베딩 저장) → 읽기(임베딩 라운드트립) → 시맨틱 recall → 임베더 실패 저하.
 * 실행: DATABASE_URL=... npx tsx packages/business/scripts/smoke-embedder-wiring.ts
 * 스모크 행은 종료 시 항상 정리된다.
 */
import { prisma } from "@sangfor/db";
import { resolveEmbedder, describeEmbedder } from "../src/domain-ai/domain-embedder-openai";
import { embeddingTextFor } from "../src/domain-ai/domain-embedder";
import { safeEmbed, recallSemanticFromDb } from "../src/domain-ai/domain-embedding";
import { upsertDomainMemory, loadDomainMemories } from "../src/domain-ai/domain-memory";

const SLUG = process.env.SMOKE_PROJECT_SLUG ?? "demo-project";
const KEY = `smoke:embedder-wiring:${Date.now()}`;

async function main() {
  console.log(`active embedder: ${describeEmbedder()}`);
  const embed = resolveEmbedder();

  // 1) 쓰기 경로: best-effort 임베딩 저장
  const text = embeddingTextFor({
    label: "smoke firewall case",
    tags: ["domain:sales", "smoke"],
    summary: "embedder wiring smoke",
  });
  const embedding = await safeEmbed(embed, text);
  if (!embedding) throw new Error("expected an embedding from the resolved embedder");
  await upsertDomainMemory({
    projectSlug: SLUG,
    domain: "sales",
    memoryType: "case",
    key: KEY,
    label: "smoke firewall case",
    tags: ["domain:sales", "smoke"],
    valueJson: { smoke: true },
    outcome: "approved",
    source: "agent",
    confidence: 90,
    embedding,
  });
  console.log(`write: stored embedding dim=${embedding.length}`);

  // 2) 읽기 경로: 실 DB 에서 임베딩 라운드트립
  const rows = await loadDomainMemories("sales", SLUG);
  const stored = rows.find((r) => r.key === KEY);
  if (!stored) throw new Error("smoke row not found after write");
  if (stored.embedding?.length !== embedding.length) {
    throw new Error(`embedding round-trip dim mismatch: ${stored.embedding?.length}`);
  }
  console.log(`read: round-tripped embedding dim=${stored.embedding.length}`);

  // 3) 시맨틱 recall: 실 DB 하이브리드 경로가 스모크 행을 찾음
  const recalled = await recallSemanticFromDb({
    domain: "sales",
    tags: ["smoke"],
    queryText: "firewall smoke case",
    embed,
    projectSlug: SLUG,
    topK: 50,
  });
  if (!recalled.some((r) => r.key === KEY)) throw new Error("semantic recall missed the smoke row");
  console.log("recall: semantic hybrid found the smoke row");

  // 4) 저하: 임베더 실패 시 태그 전용 recall 이 여전히 스모크 행을 찾음
  const degraded = await recallSemanticFromDb({
    domain: "sales",
    tags: ["smoke"],
    queryText: "firewall smoke case",
    embed: async () => {
      throw new Error("embedder down");
    },
    projectSlug: SLUG,
    topK: 50,
  });
  if (!degraded.some((r) => r.key === KEY)) throw new Error("degraded recall missed the smoke row");
  console.log("degrade: tag-only recall works when the embedder fails");
}

main()
  .catch((e) => {
    console.error("SMOKE FAILED:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.domainMemory.deleteMany({ where: { key: KEY } }).catch(() => undefined);
    await prisma.$disconnect();
  });

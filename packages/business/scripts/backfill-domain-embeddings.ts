/**
 * 기존 DomainMemory 행에 임베딩을 소급 적용(backfill)한다.
 * 임베딩이 비어있는 행만 대상으로, label+tags+summary 로 임베딩을 계산해 저장.
 *
 * 실행: npx tsx packages/business/scripts/backfill-domain-embeddings.ts
 * 운영 임베딩으로 바꾸려면 createHashEmbedder 대신 실제 Embedder 를 주입.
 */
import { prisma } from "@sangfor/db";
import { embeddingTextFor } from "../src/domain-embedder";
import { resolveEmbedder, describeEmbedder } from "../src/domain-embedder-openai";

async function main() {
  const embed = resolveEmbedder({ dim: 256 });
  console.log(`임베더: ${describeEmbedder()}`);
  const rows = await prisma.domainMemory.findMany({
    select: { id: true, label: true, tags: true, valueJson: true, embedding: true },
  });

  let updated = 0;
  let skipped = 0;
  for (const r of rows) {
    if (Array.isArray(r.embedding) && r.embedding.length > 0) {
      skipped++;
      continue;
    }
    const summary = (r.valueJson as { summary?: string } | null)?.summary ?? "";
    const text = embeddingTextFor({ label: r.label, tags: r.tags, summary });
    const embedding = await embed(text);
    await prisma.domainMemory.update({ where: { id: r.id }, data: { embedding } });
    updated++;
  }

  console.log(`backfill 완료: 갱신 ${updated}건, 건너뜀 ${skipped}건(이미 임베딩 보유). 총 ${rows.length}건`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("BACKFILL ERROR:", e);
  process.exit(1);
});

/**
 * 일회성 소급 정리 — M1-4에서 필터를 추가하기 전 생성된 아티팩트명(Example/Mail/... )
 * customer/partner 후보를 knowledge_only로 전환한다. 신규 생성은 candidates-generate.ts의
 * 필터가 이미 차단하므로, 이 스크립트는 과거분에만 필요하고 재실행해도 안전(idempotent —
 * 이미 knowledge_only인 건 대상에서 제외).
 *
 * 실행: npx tsx packages/business/scripts/suppress-artifact-candidates.ts
 * 적용: APPLY=1 npx tsx packages/business/scripts/suppress-artifact-candidates.ts
 */
import { prisma } from "@sangfor/db";
import { isArtifactEntityName } from "../src/mail/classify-rules";

const APPLY = process.env.APPLY === "1";

async function main() {
  console.log(`mode: ${APPLY ? "APPLY (writing)" : "DRY-RUN (no writes)"}`);

  const candidates = await prisma.mailDerivedCandidate.findMany({
    where: { status: "proposed", candidateType: { in: ["customer", "partner"] } },
    select: { id: true, candidateType: true, title: true, metadata: true },
  });

  const artifacts = candidates.filter((c) => {
    const entityName = c.title.replace(/^(Customer|Partner):\s*/i, "").trim();
    return isArtifactEntityName(entityName);
  });

  console.log(`scanned=${candidates.length} artifacts=${artifacts.length}`);
  for (const c of artifacts) {
    console.log(`  ${c.candidateType} "${c.title}" [${c.id}]`);
  }

  if (!APPLY || artifacts.length === 0) {
    console.log(APPLY ? "nothing to apply" : "dry-run only — re-run with APPLY=1 to write");
    await prisma.$disconnect();
    return;
  }

  let updated = 0;
  for (const c of artifacts) {
    const metadata =
      c.metadata && typeof c.metadata === "object" && !Array.isArray(c.metadata)
        ? (c.metadata as Record<string, unknown>)
        : {};
    await prisma.mailDerivedCandidate.update({
      where: { id: c.id },
      data: {
        status: "knowledge_only",
        metadata: {
          ...metadata,
          suppressedAt: new Date().toISOString(),
          suppressReason: "artifact_entity_name_backfill_2026-07-10",
        },
      },
    });
    updated += 1;
  }
  console.log(`updated=${updated}`);
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

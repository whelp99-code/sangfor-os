/**
 * ground-truth-registry의 partner 분류를 partners 테이블로 시드한다.
 * 이름 정규화 기준 idempotent(재실행 안전) — 기존 행은 건드리지 않고 없는 것만 생성.
 * 기존 3행 중 'Nexias'/'넥시아스' 중복은 레지스트리 정본명(넥시아스)만 남기고 병합하지
 * 않는다(FK 없음 확인 전 삭제 금지) — 중복 보고만 한다.
 *
 * 실행: DATABASE_URL=... pnpm --filter @sangfor/db exec tsx ../business/scripts/seed-partners-from-ground-truth.ts
 * 적용: 같은 명령에 APPLY=1
 */
import { prisma } from "@sangfor/db";
import { groundTruthByClass } from "../src/mail/ground-truth-registry";

const APPLY = process.env.APPLY === "1";

function normName(s: string): string {
  return s.replace(/\(주\)|주식회사|㈜|\s|\.|,|-/g, "").toLowerCase();
}

async function main() {
  console.log(`mode: ${APPLY ? "APPLY (writing)" : "DRY-RUN (no writes)"}`);

  const project = await prisma.project.findFirst({ orderBy: { createdAt: "asc" } });
  if (!project) throw new Error("no project row");

  const partners = groundTruthByClass("partner");
  const existing = await prisma.partner.findMany({ select: { id: true, name: true } });
  const existingNorm = new Map(existing.map((p) => [normName(p.name), p]));

  const toCreate = partners.filter((p) => !existingNorm.has(normName(p.name)));
  const skipped = partners.length - toCreate.length;

  console.log(`registry partners=${partners.length} existing=${existing.length} toCreate=${toCreate.length} skipped(existing)=${skipped}`);

  const normCounts = new Map<string, string[]>();
  for (const p of existing) {
    const key = normName(p.name);
    normCounts.set(key, [...(normCounts.get(key) ?? []), p.name]);
  }
  for (const [key, names] of normCounts) {
    if (names.length > 1) console.log(`  [dup-report] existing rows share norm "${key}": ${names.join(" / ")}`);
  }

  for (const p of toCreate) {
    console.log(`  + ${p.name} (${p.domain}) [${p.evidence}]`);
  }

  if (!APPLY) {
    console.log("dry-run only — re-run with APPLY=1 to write");
    await prisma.$disconnect();
    return;
  }

  let created = 0;
  for (const p of toCreate) {
    await prisma.partner.create({
      data: {
        projectId: project.id,
        name: p.name,
        partnerType: "ground-truth-2026-07-10",
        status: "active",
      },
    });
    created += 1;
  }
  console.log(`created=${created}, partners total now=${existing.length + created}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

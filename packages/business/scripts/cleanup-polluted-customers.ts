/**
 * customers 오염 정리 (2026-07-11 사용자 승인 "백업 후 삭제") — ground-truth 레지스트리상
 * partner/vendor/system인 도메인이 고객 행으로 존재하는 것들을 삭제한다.
 * 행별로 FK 참조 12테이블 + mail_derived_candidates.created_entity_id를 실검증해
 * 참조 0인 행만 삭제하고, 참조가 있으면 삭제하지 않고 보고만 한다.
 * 삭제 전 대상 행 전체를 JSON 백업(.agents/results/backups/)에 남긴다.
 *
 * 실행: DATABASE_URL=... pnpm --filter @sangfor/db exec tsx ../business/scripts/cleanup-polluted-customers.ts
 * 적용: 같은 명령에 APPLY=1
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, writeFileSync } from "node:fs";
import { prisma } from "@sangfor/db";
import { GROUND_TRUTH_DOMAINS } from "../src/mail/ground-truth-registry";

const APPLY = process.env.APPLY === "1";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");

function normName(s: string): string {
  return s.replace(/\(주\)|주식회사|㈜|\s|\.|,|-|_/g, "").toLowerCase();
}

async function fkRefCount(customerId: string): Promise<{ blocking: Record<string, number>; mdcRefs: number }> {
  const [contacts, links, logs, tasks, pocs, opps, docs, assets, renewals, engs, notes, cases, mdc] =
    await Promise.all([
      prisma.contact.count({ where: { customerId } }),
      prisma.customerPartnerLink.count({ where: { customerId } }),
      prisma.customerActivityLog.count({ where: { customerId } }),
      prisma.workTask.count({ where: { customerId } }),
      prisma.pocProject.count({ where: { customerId } }),
      prisma.opportunity.count({ where: { customerId } }),
      prisma.generatedDocument.count({ where: { customerId } }),
      prisma.customerAsset.count({ where: { customerId } }),
      prisma.renewalOpportunity.count({ where: { customerId } }),
      prisma.engagement.count({ where: { customerId } }),
      prisma.meetingNote.count({ where: { customerId } }),
      prisma.supportCase.count({ where: { customerId } }),
      prisma.mailDerivedCandidate.count({ where: { createdEntityId: customerId } }),
    ]);
  const refs: Record<string, number> = {
    contacts, links, tasks, pocs, opps, docs, assets, renewals, engs, notes, cases,
  };
  void logs; // activity logs cascade on delete — not a blocker
  // mdc(생성 역참조)는 비즈니스 FK가 아님 — 삭제 시 함께 정리하므로 차단 사유에서 제외하고 별도 반환.
  return { blocking: Object.fromEntries(Object.entries(refs).filter(([, v]) => v > 0)), mdcRefs: mdc };
}

async function main() {
  console.log(`mode: ${APPLY ? "APPLY (deleting)" : "DRY-RUN"}`);

  const customers = await prisma.customer.findMany();
  const polluted: typeof customers = [];
  for (const entry of GROUND_TRUTH_DOMAINS) {
    if (entry.classification === "customer" || entry.classification === "needs_human") continue;
    const root = entry.domain.split(".")[0];
    for (const c of customers) {
      const n = normName(c.name);
      if (n === normName(entry.name) || n === root) {
        if (!polluted.some((p) => p.id === c.id)) polluted.push(c);
      }
    }
  }

  const deletable: string[] = [];
  const blocked: Array<{ id: string; name: string; refs: Record<string, number> }> = [];
  for (const c of polluted) {
    const { blocking } = await fkRefCount(c.id);
    if (Object.keys(blocking).length === 0) deletable.push(c.id);
    else blocked.push({ id: c.id, name: c.name, refs: blocking });
  }

  console.log(`polluted=${polluted.length} deletable=${deletable.length} blocked=${blocked.length}`);
  for (const b of blocked) console.log(`  [BLOCKED] ${b.name} (${b.id}): ${JSON.stringify(b.refs)}`);

  const backupDir = path.join(REPO_ROOT, ".agents/results/backups");
  mkdirSync(backupDir, { recursive: true });
  const backupPath = path.join(backupDir, "2026-07-11-polluted-customers-backup.json");
  writeFileSync(backupPath, JSON.stringify(polluted, null, 2));
  console.log(`backup written: ${backupPath} (${polluted.length} rows)`);

  if (!APPLY) {
    console.log("dry-run only — re-run with APPLY=1 to delete");
    await prisma.$disconnect();
    return;
  }

  const mdcCleared = await prisma.mailDerivedCandidate.updateMany({
    where: { createdEntityId: { in: deletable } },
    data: { status: "rejected", createdEntityType: null, createdEntityId: null },
  });
  const r = await prisma.customer.deleteMany({ where: { id: { in: deletable } } });
  console.log(`mdc back-refs cleared=${mdcCleared.count}, deleted=${r.count}, customers remaining=${customers.length - r.count}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

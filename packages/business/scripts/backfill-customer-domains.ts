/**
 * ground-truth-registry 기반 Customer.domain 백필 (M2 Track C Step 5).
 * customer로 분류된 도메인만 이름 매칭(정규화명 또는 도메인 루트)으로 domain을 채운다.
 * 레지스트리상 partner/vendor/system인데 customers에 행이 있는 오염분은 보고만 하고
 * 절대 쓰지 않는다 — 삭제/이관은 FK 조사와 사용자 승인이 필요한 별도 결정.
 *
 * 실행: DATABASE_URL=... pnpm --filter @sangfor/db exec tsx ../business/scripts/backfill-customer-domains.ts
 * 적용: 같은 명령에 APPLY=1
 */
import { prisma } from "@sangfor/db";
import { GROUND_TRUTH_DOMAINS } from "../src/mail/ground-truth-registry";

const APPLY = process.env.APPLY === "1";

function normName(s: string): string {
  return s.replace(/\(주\)|주식회사|㈜|\s|\.|,|-|_/g, "").toLowerCase();
}

function domainRoot(domain: string): string {
  return domain.split(".")[0];
}

async function main() {
  console.log(`mode: ${APPLY ? "APPLY (writing)" : "DRY-RUN (no writes)"}`);

  const customers = await prisma.customer.findMany({
    select: { id: true, name: true, domain: true },
  });

  const toSet: Array<{ id: string; name: string; domain: string }> = [];
  const pollution: Array<{ name: string; domain: string; cls: string }> = [];

  for (const entry of GROUND_TRUTH_DOMAINS) {
    const root = domainRoot(entry.domain);
    const matches = customers.filter((c) => {
      const n = normName(c.name);
      return n === normName(entry.name) || n === root;
    });
    for (const c of matches) {
      if (entry.classification === "customer") {
        if (!c.domain) toSet.push({ id: c.id, name: c.name, domain: entry.domain });
      } else if (entry.classification !== "needs_human") {
        pollution.push({ name: c.name, domain: entry.domain, cls: entry.classification });
      }
    }
  }

  console.log(`customers=${customers.length} domainToSet=${toSet.length} pollutionRows=${pollution.length}`);
  console.log("\n-- domain 백필 대상 (customer 분류) --");
  for (const t of toSet) console.log(`  ${t.name} <- ${t.domain}`);
  console.log("\n-- 오염 보고 (customers 행인데 레지스트리상 partner/vendor/system — 쓰기 없음) --");
  for (const p of pollution) console.log(`  [${p.cls}] ${p.name} (${p.domain})`);

  if (!APPLY) {
    console.log("\ndry-run only — re-run with APPLY=1 to write");
    await prisma.$disconnect();
    return;
  }

  let updated = 0;
  for (const t of toSet) {
    await prisma.customer.update({ where: { id: t.id }, data: { domain: t.domain } });
    updated += 1;
  }
  console.log(`\nupdated=${updated}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

/**
 * 딜 체인 백필 — 딜 78건 전부가 파트너·총판 미지정이라 유통 구조가 데이터에 없다.
 *
 * 근거는 메일이다. 딜은 두 갈래로 생겼다:
 *  - 메일 파생(40건): 딜 → 후보 → 스레드 → participant_domains. 참여 도메인이 곧 상대다.
 *  - CRM 임포트(40건, 7/1): 메일 연결이 없다. 고객명으로 메일 스레드를 역추적해
 *    그 고객을 다룬 파트너 도메인을 찾는다.
 *
 * 도메인 → 역할은 학습된 PolicyMemory를 쓴다. 근거가 없으면 비워 둔다 —
 * 추측으로 채우면 유통 구조를 지어내는 것이고, 빈 칸보다 나쁘다.
 *
 * Usage: tsx packages/business/scripts/backfill-deal-chain.ts [--apply]
 */
import { prisma } from "@sangfor/db";

const APPLY = process.argv.includes("--apply");

// 베를로가 견적·라이선스를 '의뢰해 받는' 위쪽 공급선. 아래쪽 SI/리셀러와 구분해야
// 딜 체인(고객 → SI → 베를로 → 총판 → 벤더)이 방향대로 선다.
const DISTRIBUTOR_DOMAINS = new Set(["nexias.co.kr", "syinet.com"]);

const VENDOR_DOMAINS = new Set(["sangfor.com", "aveva.com", "chinatelecomglobal.com"]);
const INTERNAL_DOMAINS = new Set(["blro.co.kr"]);

interface Resolved {
  customerId?: string;
  partnerId?: string;
  distributorId?: string;
}

async function main() {
  const [customers, partners, policies] = await Promise.all([
    prisma.customer.findMany({ select: { id: true, name: true } }),
    prisma.partner.findMany({ select: { id: true, name: true } }),
    prisma.policyMemory.findMany({
      where: { status: { in: ["active", "approved"] } },
      select: { memoryType: true, key: true, label: true },
    }),
  ]);

  const partnerByName = new Map(partners.map((p) => [p.name.trim().toLowerCase(), p.id]));
  const customerByName = new Map(customers.map((c) => [c.name.trim().toLowerCase(), c.id]));

  // 도메인 → 회사명. 학습된 엔티티 맵의 label이 회사명이다.
  const companyOfDomain = new Map<string, string>();
  for (const p of policies) {
    if (p.memoryType === "known_partner_domain") companyOfDomain.set(p.key, p.label);
  }
  const customerDomains = new Map<string, string>([
    ["gsenc.com", "GS건설"],
    ["gsitm.com", "GSITM"],
    ["incar.co.kr", "인카금융서비스"],
    ["chosun.com", "조선일보JNS"],
    ["sgnine.co.kr", "에스지나인"],
    ["ipageon.com", "아이페이지온"],
    ["vitalchem.com", "VitalChem"],
  ]);

  function resolveDomains(domains: string[]): Resolved {
    const out: Resolved = {};
    for (const raw of domains) {
      const d = raw.trim().toLowerCase();
      if (INTERNAL_DOMAINS.has(d) || VENDOR_DOMAINS.has(d)) continue;

      const customerName = customerDomains.get(d);
      if (customerName) {
        const id = customerByName.get(customerName.toLowerCase());
        if (id && !out.customerId) out.customerId = id;
        continue;
      }

      const partnerName = companyOfDomain.get(d);
      if (!partnerName) continue;
      const id = partnerByName.get(partnerName.trim().toLowerCase());
      if (!id) continue;
      if (DISTRIBUTOR_DOMAINS.has(d)) {
        if (!out.distributorId) out.distributorId = id;
      } else if (!out.partnerId) {
        out.partnerId = id;
      }
    }
    return out;
  }

  const deals = await prisma.opportunity.findMany({
    select: { id: true, title: true, customerId: true, partnerId: true, distributorId: true },
  });

  // 1) 메일 파생 딜 — 스레드 참여 도메인이 곧 상대다.
  const linked = await prisma.mailDerivedCandidate.findMany({
    where: { createdEntityType: "opportunity", createdEntityId: { not: null } },
    select: { createdEntityId: true, mailInsightThread: { select: { participantDomains: true } } },
  });
  const domainsOfDeal = new Map<string, string[]>();
  for (const l of linked) {
    const d = l.mailInsightThread?.participantDomains ?? [];
    if (d.length) domainsOfDeal.set(l.createdEntityId!, d as string[]);
  }

  // 2) CRM 임포트 딜 — 고객명으로 스레드를 역추적해 그 고객을 다룬 파트너를 찾는다.
  const threads = await prisma.mailInsightThread.findMany({
    select: { threadTitle: true, summary: true, participantDomains: true },
  });

  let updated = 0;
  const rows: string[] = [];

  for (const deal of deals) {
    let domains = domainsOfDeal.get(deal.id);

    if (!domains) {
      const customerName = customers.find((c) => c.id === deal.customerId)?.name;
      if (customerName && customerName.length >= 2) {
        const hits = threads.filter(
          (t) =>
            (t.threadTitle ?? "").includes(customerName) ||
            (t.summary ?? "").includes(customerName),
        );
        const merged = [...new Set(hits.flatMap((t) => (t.participantDomains ?? []) as string[]))];
        if (merged.length) domains = merged;
      }
    }
    if (!domains) continue;

    const r = resolveDomains(domains);
    const patch: Resolved = {};
    if (!deal.customerId && r.customerId) patch.customerId = r.customerId;
    if (!deal.partnerId && r.partnerId) patch.partnerId = r.partnerId;
    if (!deal.distributorId && r.distributorId) patch.distributorId = r.distributorId;
    if (Object.keys(patch).length === 0) continue;

    const names = [
      patch.customerId ? `고객=${customers.find((c) => c.id === patch.customerId)?.name}` : "",
      patch.partnerId ? `파트너=${partners.find((p) => p.id === patch.partnerId)?.name}` : "",
      patch.distributorId
        ? `총판=${partners.find((p) => p.id === patch.distributorId)?.name}`
        : "",
    ].filter(Boolean);
    rows.push(`  ${deal.title.slice(0, 40).padEnd(42)} ${names.join(" · ")}`);
    updated++;

    if (APPLY) {
      await prisma.opportunity.update({ where: { id: deal.id }, data: patch });
    }
  }

  console.log(`딜 ${deals.length}건 검토 — 백필 대상 ${updated}건${APPLY ? "" : " (dry-run)"}\n`);
  for (const r of rows) console.log(r);

  if (!APPLY) return;

  const after = await prisma.opportunity.findMany({
    select: { customerId: true, partnerId: true, distributorId: true },
  });
  console.log(
    `\n반영 후 — 고객 지정 ${after.filter((d) => d.customerId).length}/${after.length} · ` +
      `파트너 ${after.filter((d) => d.partnerId).length} · 총판 ${after.filter((d) => d.distributorId).length}`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

/**
 * 엔티티 정리 — 감사(DATA-AUDIT.md)가 찾은 오등록을 바로잡는다.
 *
 * 고객 98곳 중 34곳이 고객이 아니었다. 메일 제목("견적요청"), 도메인("naver.com"),
 * 시스템 발신("SNET 구매포탈"), 심지어 자사("배를로")까지 고객으로 올라와 있었다.
 * 분류기가 엔티티 자격을 검증하지 않고 이름을 승격한 결과다.
 *
 * 참조를 먼저 옮기고 지운다. 딜이 걸린 행은 절대 그냥 삭제하지 않는다.
 *
 * Usage: tsx packages/business/scripts/cleanup-entities.ts [--apply]
 */
import { prisma } from "@sangfor/db";

const APPLY = process.argv.includes("--apply");

// 회사가 아닌 것들. 메일 제목·서술문·부서명·시스템 발신·일반 도메인·자사.
const NOT_A_COMPANY = [
  "CPQ",
  "Critical",
  "견적 요청",
  "견적 확인 요청",
  "견적요청",
  "서명요청",
  "품질보증서",
  "상포HCI 관련 문의 드립니다.",
  "리뉴얼",
  "협업툴 플로우",
  "구매팀",
  "🔔HR/법무/구매 필독",
  "VDI-Korean-POC",
  "SteelEye DB이중화솔루션 잔여물량 재설치",
  "Sangfor 서버가상화",
  "SNET 구매포탈",
  "GSITM_구매팀",
  "GSITM_시스템알림",
  "naver.com",
  "배를로",
];

// customers에 있으나 실제로는 파트너. partners의 기존 표기로 병합한다 —
// 값이 있으면 그 이름의 파트너로 흡수하고, null이면 같은 이름으로 새로 만든다.
// 이형 표기를 그대로 만들면 파트너가 이중 등록된다(인성디지탈 vs ISD).
const CUSTOMER_IS_PARTNER: Record<string, string | null> = {
  인성디지탈: "ISD",
  "(주)인성디지탈": "ISD",
  진플러스: "진플러스",
  지티솔루션: "GT솔루션",
  "CMT정보통신-이명찬": "씨엠티정보",
  HC코퍼레이션: "에이치씨코퍼레이션",
  "고위드-유클릭스": "유클릭",
};

// partners에 있으나 실제로는 고객. customers로 옮긴다.
const PARTNER_IS_CUSTOMER = ["GSITM", "에스지나인", "아이페이지온"];

// 도메인 루트가 이름이 된 행 → 정식 상호로 병합. 딜 참조는 정식 행으로 옮긴다.
const CANONICAL: Record<string, string> = {
  Gsenc: "GS건설",
  Incar: "인카금융서비스",
  Chosun: "조선일보JNS",
  Syinet: "세연아이넷",
  Jngsystem: "JNG System",
  "1an": "일에이엔",
  Uai: "유에이아이",
};

async function repointOpportunities(fromCustomerId: string, toCustomerId: string | null) {
  await prisma.opportunity.updateMany({
    where: { customerId: fromCustomerId },
    data: { customerId: toCustomerId },
  });
}

async function main() {
  const customers = await prisma.customer.findMany({ select: { id: true, name: true, projectId: true } });
  const partners = await prisma.partner.findMany({ select: { id: true, name: true } });
  const partnerByName = new Map(partners.map((p) => [p.name.trim(), p.id]));
  const customerByName = new Map(customers.map((c) => [c.name.trim(), c.id]));

  const dealCount = async (customerId: string) =>
    prisma.opportunity.count({ where: { customerId } });

  const plan = { garbage: [] as string[], toPartner: [] as string[], toCustomer: [] as string[], merged: [] as string[] };

  console.log(`고객 ${customers.length} · 파트너 ${partners.length}${APPLY ? "" : "  (dry-run — --apply로 반영)"}\n`);

  // 1) 회사가 아닌 행 — 딜이 걸려 있으면 고객을 비우고(미지정), 행은 지운다.
  for (const name of NOT_A_COMPANY) {
    const id = customerByName.get(name);
    if (!id) continue;
    const deals = await dealCount(id);
    plan.garbage.push(`${name}${deals ? ` (딜 ${deals}건 → 고객 미지정으로 해제)` : ""}`);
    if (!APPLY) continue;
    if (deals) await repointOpportunities(id, null);
    await prisma.customer.delete({ where: { id } });
  }

  // 2) 고객으로 잘못 올라온 파트너 — 딜은 유지한 채 partners로 옮긴다.
  for (const [name, partnerName] of Object.entries(CUSTOMER_IS_PARTNER)) {
    const id = customerByName.get(name);
    if (!id) continue;
    const deals = await dealCount(id);
    const target = partnerName ?? name;
    const existing = partnerByName.get(target);
    plan.toPartner.push(
      `${name} → 파트너 "${target}"${existing ? " (기존 행에 병합)" : " (신규)"}${deals ? ` · 딜 ${deals}건 고객 해제` : ""}`,
    );
    if (!APPLY) continue;
    if (deals) await repointOpportunities(id, null);
    if (!existing) {
      const c = customers.find((x) => x.id === id)!;
      await prisma.partner.create({
        data: { projectId: c.projectId, name: target, partnerType: "mail-derived" },
      });
    }
    await prisma.customer.delete({ where: { id } });
  }

  // 3) 파트너로 잘못 올라온 고객 — customers에 없으면 만들고, partners 행은 지운다.
  for (const name of PARTNER_IS_CUSTOMER) {
    const pid = partnerByName.get(name);
    if (!pid) continue;
    const alreadyCustomer = customerByName.has(name);
    plan.toCustomer.push(`${name}${alreadyCustomer ? " (고객에 이미 존재 — 파트너 행만 제거)" : " → customers 신규"}`);
    if (!APPLY) continue;
    if (!alreadyCustomer) {
      const projectId = customers[0]?.projectId;
      if (projectId) await prisma.customer.create({ data: { projectId, name } });
    }
    await prisma.partner.delete({ where: { id: pid } });
  }

  // 4) 도메인 루트 이름 → 정식 상호로 병합. 딜은 정식 행으로 옮긴다.
  for (const [rootName, canonical] of Object.entries(CANONICAL)) {
    const dupId = customerByName.get(rootName);
    if (!dupId) continue;
    const canonicalId = customerByName.get(canonical);
    const deals = await dealCount(dupId);
    plan.merged.push(`${rootName} → ${canonical}${deals ? ` (딜 ${deals}건 이관)` : ""}${canonicalId ? "" : " ⚠ 정식 행 없음 — 리네임"}`);
    if (!APPLY) continue;
    if (canonicalId) {
      if (deals) await repointOpportunities(dupId, canonicalId);
      await prisma.customer.delete({ where: { id: dupId } });
    } else {
      await prisma.customer.update({ where: { id: dupId }, data: { name: canonical } });
    }
  }

  // 5) 후보 원장의 댕글링 — 생성했다던 엔티티가 사라졌으면 converted가 아니다.
  const dangling = await prisma.mailDerivedCandidate.findMany({
    where: { status: "converted", createdEntityType: "customer", createdEntityId: { not: null } },
    select: { id: true, createdEntityId: true },
  });
  const liveIds = new Set((await prisma.customer.findMany({ select: { id: true } })).map((c) => c.id));
  const orphans = dangling.filter((d) => !liveIds.has(d.createdEntityId!));
  console.log(`\n[1] 회사가 아닌 고객 행 ${plan.garbage.length}건`);
  for (const g of plan.garbage) console.log(`    ${g}`);
  console.log(`\n[2] 고객 → 파트너 ${plan.toPartner.length}건`);
  for (const t of plan.toPartner) console.log(`    ${t}`);
  console.log(`\n[3] 파트너 → 고객 ${plan.toCustomer.length}건`);
  for (const t of plan.toCustomer) console.log(`    ${t}`);
  console.log(`\n[4] 도메인루트 → 정식상호 병합 ${plan.merged.length}건`);
  for (const m of plan.merged) console.log(`    ${m}`);
  console.log(`\n[5] 후보 원장 댕글링 ${orphans.length}건 (converted인데 생성 엔티티 없음 → rejected)`);

  if (!APPLY) return;

  for (const o of orphans) {
    await prisma.mailDerivedCandidate.update({
      where: { id: o.id },
      data: { status: "rejected", createdEntityId: null, createdEntityType: null },
    });
  }

  const [c, p] = await Promise.all([prisma.customer.count(), prisma.partner.count()]);
  console.log(`\n반영 완료 — 고객 ${customers.length} → ${c} · 파트너 ${partners.length} → ${p}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

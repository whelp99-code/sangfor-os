/**
 * GSITM 딜 11건 → 실제 5건으로 재구성.
 *
 * GSITM 구매시스템은 한 건을 여러 메일로 알린다: 견적요청 → 지정견적 요청 →
 * 견적/정보의견 확인요청 → 계약완료 안내. 분류기가 메일마다 딜을 만들어 같은 건이
 * 4개로 갈라졌다. 묶는 열쇠는 **계약번호**다(계약완료 안내 본문에 있다).
 *
 * 계약완료 안내 = "위 프로젝트는 계약이 완료 되었습니다" → 수주(WON)다.
 * 금액은 검수승인금액 메일에 있다.
 *
 * Usage: tsx packages/business/scripts/regroup-gsitm-deals.ts [--apply]
 */
import { prisma } from "@sangfor/db";

const APPLY = process.argv.includes("--apply");

interface Case {
  contract: string | null;
  title: string;
  customer: string;
  stage: "LEAD" | "PROPOSAL" | "WON";
  dealStatus: "OPEN" | "WON";
  amount: number | null;
  closeDate?: string;
  /** 이 건으로 묶일 딜 제목의 조각. 하나라도 맞으면 같은 건이다. */
  matches: string[];
  note: string;
}

const CASES: Case[] = [
  {
    contract: "49158",
    title: "GS건설 VDI 라이선스 공급(1Y) (26년~27년)",
    customer: "GS건설",
    stage: "WON",
    dealStatus: "WON",
    amount: 9_000_000,
    closeDate: "2026-03-17",
    matches: ["GS건설 VDI라이선스 공급(1Y)", "GS건설 VDI 라이선스 공급(1Y)", "49158"],
    note: "계약완료 2026-03-17 · 검수승인금액 9,000,000 (2026-04)",
  },
  {
    contract: "49432",
    title: "GS건설 디지털트윈팀 HCI 라이선스 공급(1Y)(26년~27년)",
    customer: "GS건설",
    stage: "WON",
    dealStatus: "WON",
    amount: null,
    closeDate: "2026-06-24",
    matches: ["디지털트윈팀 HCI 라이선스 공급(1Y)", "49432"],
    note: "계약완료 2026-06-24 · 검수 전이라 금액 미확정",
  },
  {
    contract: "48447",
    title: "유니드그룹 IDC 및 운영 사업(26년~28년)",
    customer: "유니드",
    stage: "WON",
    dealStatus: "WON",
    amount: 16_360_000,
    closeDate: "2026-01-13",
    matches: ["유니드그룹 IDC"],
    note: "계약완료 2026-01-13 · 검수승인금액 16,360,000 (2026-01). 최종고객은 GS건설이 아니라 유니드",
  },
  {
    contract: null,
    title: "GS건설 디지털트윈팀 VDI 공급 26년",
    customer: "GS건설",
    stage: "PROPOSAL",
    dealStatus: "OPEN",
    amount: null,
    matches: ["디지털트윈팀 VDI 공급 26년"],
    note: "계약번호 없음 — 견적 요청 단계",
  },
];

async function main() {
  const deals = await prisma.opportunity.findMany({
    where: { OR: [{ title: { contains: "GSITM" } }, { title: { contains: "계약완료" } }] },
    select: { id: true, title: true, stage: true, amount: true },
  });

  console.log(`GSITM 계열 딜 ${deals.length}건${APPLY ? "" : " (dry-run — --apply로 반영)"}\n`);

  const claimed = new Set<string>();
  const gsitmId = (await prisma.partner.findFirst({ where: { name: "GSITM" } }))?.id;

  for (const c of CASES) {
    const group = deals.filter(
      (d) => !claimed.has(d.id) && c.matches.some((m) => d.title.includes(m)),
    );
    if (group.length === 0) continue;
    group.forEach((d) => claimed.add(d.id));

    const keep = group[0];
    const drop = group.slice(1);
    const customerId = (await prisma.customer.findFirst({ where: { name: c.customer } }))?.id;

    console.log(`■ ${c.contract ? `계약 ${c.contract}` : "계약 없음"} — ${c.title}`);
    console.log(`   ${c.note}`);
    console.log(`   딜 ${group.length}건 → 1건 (고객=${c.customer}, ${c.stage}, ${c.amount ? c.amount.toLocaleString() : "금액 미정"})`);
    for (const d of drop) console.log(`     흡수: ${d.title.slice(0, 52)}`);

    if (!APPLY) continue;

    await prisma.opportunity.update({
      where: { id: keep.id },
      data: {
        title: c.title,
        customerId: customerId ?? null,
        partnerId: gsitmId ?? null,
        stage: c.stage,
        dealStatus: c.dealStatus,
        amount: c.amount,
        closeDate: c.closeDate ? new Date(c.closeDate) : null,
        nextAction: c.contract ? `GSITM 계약 ${c.contract} — 검수·세금계산서 진행` : "견적 회신 대기",
      },
    });
    for (const d of drop) {
      await prisma.opportunity.delete({ where: { id: d.id } });
    }
  }

  const leftovers = deals.filter((d) => !claimed.has(d.id));
  if (leftovers.length) {
    console.log(`\n■ 별개 유지 ${leftovers.length}건`);
    for (const d of leftovers) console.log(`   ${d.title.slice(0, 56)}`);
  }

  if (!APPLY) return;
  const after = await prisma.opportunity.count({
    where: { OR: [{ title: { contains: "GSITM" } }, { title: { contains: "GS건설" } }, { title: { contains: "유니드" } }] },
  });
  console.log(`\n반영 완료 — GSITM 계열 딜 ${after}건, 전체 ${await prisma.opportunity.count()}건`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

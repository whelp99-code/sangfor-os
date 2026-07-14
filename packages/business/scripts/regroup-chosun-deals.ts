/**
 * 조선일보 계열 딜 재구성 — 겹친 5건 → 실제 3건.
 *
 * 디지틀조선일보는 조선일보그룹의 IT 조달 창구다. 계열사(조선일보JNS·게임조선)와
 * 자체 운영 건이 모두 이 파트너를 통해 나가서, 분류기가 스레드마다 딜을 만들어
 * 같은 계열이 5개로 갈라졌다. 남은 6,400,000·4,500,000은 실제 매출이 아니다:
 * 6,400,000은 견적서 템플릿 시트(aSV 4×1,600,000)에서 긁힌 값이고,
 * 4,500,000은 아래 3,000,000 + 1,500,000을 한 번 더 센 값이다. 두면 이중계상된다.
 *
 * 귀속은 대표 확인(2026-07-14)을 따른다 — 2025-12 계산서 2,400,000은 조선일보JNS
 * 견적서 금액과 같지만 실제로는 디지틀조선일보 자체 운영 건이다.
 *
 * Usage: tsx packages/business/scripts/regroup-chosun-deals.ts [--apply]
 */
import { prisma } from "@sangfor/db";

const APPLY = process.argv.includes("--apply");

const PARTNER = "디지틀조선일보";

const CASES = [
  {
    title: "디지틀조선일보 - 자체운영 리뉴얼",
    customer: "디지틀조선일보",
    amount: 2_400_000,
    closeDate: "2025-12-01",
    absorb: ["조선일보그룹 리뉴얼 - 2개"],
    note: "계산서 2025-12 · 2,400,000 (미수)",
  },
  {
    title: "조선일보JNS - HCI 리뉴얼",
    customer: "조선일보JNS",
    amount: 3_000_000,
    closeDate: "2026-04-01",
    absorb: ["조선일로 JNS - 리뉴얼", "JNS 조선일보/게임조건 HCI Renewal"],
    note: "계산서 2026-04 · 3,000,000 (미수). 견적 3,300,000과 다르면 계산서가 정본",
  },
  {
    title: "게임조선 - HCI 리뉴얼",
    customer: "게임조선",
    amount: 1_500_000,
    closeDate: "2026-04-01",
    absorb: ["디지털조선 - 리뉴얼", "디지틀조선일보 Sangfor HCI Renewal"],
    note: "계산서 2026-04 · 1,500,000 (미수). 견적 1,880,000과 다르면 계산서가 정본",
  },
];

async function main() {
  console.log(`조선일보 계열 재구성${APPLY ? "" : " (dry-run — --apply로 반영)"}\n`);

  const projectId = (await prisma.opportunity.findFirst({ select: { projectId: true } }))?.projectId;
  if (!projectId) throw new Error("projectId를 찾을 수 없다");
  const partnerId = (await prisma.partner.findFirst({ where: { name: PARTNER } }))?.id ?? null;

  for (const c of CASES) {
    const customerId = (await prisma.customer.findFirst({ where: { name: c.customer } }))?.id ?? null;
    if (!customerId) console.log(`  ⚠ 고객 없음: ${c.customer}`);

    const data = {
      title: c.title,
      customerId,
      partnerId,
      amount: c.amount,
      stage: "WON" as const,
      dealStatus: "WON" as const,
      closeDate: new Date(c.closeDate),
      nextAction: "세금계산서 발행됨 — 입금 확인(미수)",
    };

    const existing = await prisma.opportunity.findFirst({ where: { title: c.title } });
    console.log(`■ ${c.title}  ${c.amount.toLocaleString()}원`);
    console.log(`   ${c.note}`);

    if (!APPLY) {
      for (const frag of c.absorb) {
        const dups = await prisma.opportunity.findMany({
          where: { title: { contains: frag } },
          select: { title: true, amount: true },
        });
        for (const d of dups) {
          const amt = d.amount == null ? "금액없음" : Number(d.amount).toLocaleString();
          console.log(`   흡수·삭제 예정: ${d.title.slice(0, 50)} (${amt})`);
        }
      }
      console.log();
      continue;
    }

    const dealId = existing
      ? (await prisma.opportunity.update({ where: { id: existing.id }, data })).id
      : (await prisma.opportunity.create({ data: { ...data, projectId } })).id;

    for (const frag of c.absorb) {
      const dups = await prisma.opportunity.findMany({
        where: { title: { contains: frag }, id: { not: dealId } },
        select: { id: true, title: true },
      });
      for (const d of dups) {
        // 납품(Engagement)·견적은 딜에 restrict로 묶여 있다. 지우지 말고 살아남는 딜로 옮긴다
        // — 중복 딜을 정리하려다 실제 납품 이력을 날리면 복구할 방법이 없다.
        // Engagement.opportunityId는 unique라 대상 딜에 이미 있으면 옮길 수 없다.
        const taken = await prisma.engagement.findUnique({ where: { opportunityId: dealId } });
        const moved = taken
          ? { count: 0 }
          : await prisma.engagement.updateMany({
              where: { opportunityId: d.id },
              data: { opportunityId: dealId, name: c.title },
            });
        if (taken) {
          const orphan = await prisma.engagement.findUnique({ where: { opportunityId: d.id } });
          if (orphan) throw new Error(`납품 이력 충돌 — 수동 확인 필요: ${d.title} / ${c.title}`);
        }
        const quotes = await prisma.quote.updateMany({
          where: { opportunityId: d.id },
          data: { opportunityId: dealId },
        });
        const carried = [
          moved.count ? `납품 ${moved.count}` : "",
          quotes.count ? `견적 ${quotes.count}` : "",
        ].filter(Boolean);

        console.log(
          `   흡수·삭제: ${d.title.slice(0, 46)}${carried.length ? `  (이관: ${carried.join(", ")})` : ""}`,
        );
        await prisma.opportunity.delete({ where: { id: d.id } });
      }
    }
    console.log();
  }

  if (!APPLY) return;

  const left = await prisma.opportunity.findMany({
    where: { OR: [{ title: { contains: "조선" } }, { title: { contains: "게임조선" } }] },
    select: { title: true, amount: true, dealStatus: true },
  });
  console.log("반영 후 조선일보 계열:");
  for (const d of left) {
    const amt = d.amount == null ? "금액없음" : Number(d.amount).toLocaleString();
    console.log(`  ${d.title.padEnd(30)} ${amt.padStart(11)}원  ${d.dealStatus}`);
  }
  const won = await prisma.opportunity.aggregate({
    where: { dealStatus: "WON" },
    _count: true,
    _sum: { amount: true },
  });
  console.log(
    `\n수주 ${won._count}건 · ${Number(won._sum.amount ?? 0).toLocaleString()}원 / 전체 딜 ${await prisma.opportunity.count()}건`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

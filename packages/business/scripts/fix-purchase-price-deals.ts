/**
 * 매입가가 매출로 잡힌 딜 정리 — 대표 확인(2026-07-14).
 *
 * 넥시아스 견적서 PDF가 프로젝트 폴더에 같이 들어 있어서, 분류기가 그 금액을 딜에
 * 넣었다. 그래서 같은 건이 두 딜로 갈라졌다 — 하나는 매입가, 하나는 매출가다.
 * 매입가 딜을 지우고 매출가 딜만 남긴다. 근거:
 *
 *  GS건설 VDI 리뉴얼  매입 3,600,000(넥시아스 260202) / 매출 9,000,000(내 견적 20260210
 *                     = GSITM 세금계산서, 계약 49158 검수승인)
 *  유니드그룹        매입 11,000,000(넥시아스 251217) / 매출 16,360,000(세금계산서 원본
 *                     품목이 '유니드그룹 IDC 및 운영 사업(26년~28년)' — 같은 건이다)
 *
 * KV머티리얼즈는 굿어스 구매포탈 계약이 정본이다: IAG(EPO2602-011) 9,360,000 —
 * 월 780,000 × 12개월, NGAF(EPO2602-035) 3,300,000. 내가 보낸 견적서와 일치한다.
 * 넥시아스 매입은 5,000,000.
 *
 * Usage: tsx packages/business/scripts/fix-purchase-price-deals.ts [--apply]
 */
import { prisma } from "@sangfor/db";

const APPLY = process.argv.includes("--apply");

interface Fix {
  keep: string;
  title?: string;
  customer?: string;
  partner?: string;
  amount?: number;
  stage?: "WON" | "PROPOSAL";
  dealStatus?: "WON" | "OPEN";
  nextAction?: string;
  drop?: string[];
  why: string;
}

const FIXES: Fix[] = [
  {
    keep: "GS건설 VDI 라이선스 공급(1Y)",
    amount: 9_000_000,
    drop: ["GS건설 - VDI 리뉴얼"],
    why: "매출 9,000,000 (내 견적 20260210 + GSITM 세금계산서). 지우는 3,600,000은 넥시아스 매입가",
  },
  {
    keep: "유니드그룹 IDC 및 운영 사업",
    partner: "GSITM",
    amount: 16_360_000,
    drop: ["UNID - 리뉴얼"],
    why: "매출 16,360,000 (세금계산서 원본 품목이 이 딜명 그대로다). 지우는 11,000,000은 넥시아스 매입가",
  },
  {
    keep: "인카금융서비스 - aSV",
    stage: "PROPOSAL",
    dealStatus: "OPEN",
    nextAction: "제안 진행 중 — 수주 전",
    why: "대표 확인: 현재 진행 중인 프로젝트다. 수주(WON)가 아니다",
  },
  {
    keep: "케이브이머티리얼즈 - HCI 서버 유지보수(12개월)",
    title: "케이브이머티리얼즈 - IAG 유지보수(12개월)",
    customer: "케이브이머티리얼즈",
    partner: "굿어스",
    amount: 9_360_000,
    stage: "WON",
    dealStatus: "WON",
    nextAction: "굿어스 계약 EPO2602-011 — 월 780,000 × 12개월 분할 청구",
    drop: ["KV메트리얼즈 - IAG리뉴얼"],
    why: "굿어스 계약금액 9,360,000 = 내 견적서와 일치. 지우는 9,960,000은 견적서 셀에서 잘못 긁힌 값",
  },
  {
    keep: "케이브이머티리얼즈 - NGAF 라이선스 갱신",
    customer: "케이브이머티리얼즈",
    partner: "굿어스",
    amount: 3_300_000,
    stage: "WON",
    dealStatus: "WON",
    nextAction: "굿어스 계약 EPO2602-035 — 라이선스 1,900,000 + 기술지원 월빌링",
    why: "굿어스 계약금액 3,300,000 (구매포탈 메일). 별도 계약이라 IAG 건과 분리한다",
  },
];

async function main() {
  console.log(`딜 정리 ${FIXES.length}건${APPLY ? "" : " (dry-run — --apply로 반영)"}\n`);

  const projectId = (await prisma.opportunity.findFirst({ select: { projectId: true } }))?.projectId;
  if (!projectId) throw new Error("projectId를 찾을 수 없다");

  for (const f of FIXES) {
    const existing = await prisma.opportunity.findFirst({
      where: { title: { contains: f.keep } },
      select: { id: true, title: true, amount: true, dealStatus: true },
    });

    const customerId = f.customer
      ? (await prisma.customer.findFirst({ where: { name: f.customer } }))?.id ?? null
      : undefined;
    const partnerId = f.partner
      ? (await prisma.partner.findFirst({ where: { name: f.partner } }))?.id ?? null
      : undefined;

    const before = existing?.amount == null ? "없음" : Number(existing.amount).toLocaleString();
    const after = f.amount == null ? before : f.amount.toLocaleString();
    console.log(`■ ${f.title ?? existing?.title ?? f.keep}`);
    console.log(
      `   ${existing ? `${before} → ${after}` : `신규 — ${after}`}${f.dealStatus ? `  [${existing?.dealStatus ?? "-"} → ${f.dealStatus}]` : ""}`,
    );
    console.log(`   ${f.why}`);

    const data = {
      ...(f.title ? { title: f.title } : {}),
      ...(f.amount != null ? { amount: f.amount } : {}),
      ...(customerId !== undefined ? { customerId } : {}),
      ...(partnerId !== undefined ? { partnerId } : {}),
      ...(f.stage ? { stage: f.stage } : {}),
      ...(f.dealStatus ? { dealStatus: f.dealStatus } : {}),
      ...(f.nextAction ? { nextAction: f.nextAction } : {}),
    };

    if (!APPLY) {
      for (const frag of f.drop ?? []) {
        const dups = await prisma.opportunity.findMany({
          where: { title: { contains: frag } },
          select: { title: true, amount: true },
        });
        for (const d of dups) {
          const amt = d.amount == null ? "금액없음" : Number(d.amount).toLocaleString();
          console.log(`   삭제 예정: ${d.title.slice(0, 48)} (${amt} — 매입가)`);
        }
      }
      console.log();
      continue;
    }

    const dealId = existing
      ? (await prisma.opportunity.update({ where: { id: existing.id }, data })).id
      : (
          await prisma.opportunity.create({
            data: { title: f.title ?? f.keep, projectId, ...data },
          })
        ).id;

    for (const frag of f.drop ?? []) {
      const dups = await prisma.opportunity.findMany({
        where: { title: { contains: frag }, id: { not: dealId } },
        select: { id: true, title: true },
      });
      for (const d of dups) {
        // 납품·견적은 restrict라 지우기 전에 살아남는 딜로 옮겨야 한다.
        const taken = await prisma.engagement.findUnique({ where: { opportunityId: dealId } });
        if (!taken) {
          await prisma.engagement.updateMany({
            where: { opportunityId: d.id },
            data: { opportunityId: dealId },
          });
        }
        await prisma.quote.updateMany({
          where: { opportunityId: d.id },
          data: { opportunityId: dealId },
        });
        console.log(`   삭제: ${d.title.slice(0, 48)}`);
        await prisma.opportunity.delete({ where: { id: d.id } });
      }
    }
    console.log();
  }

  if (!APPLY) return;
  const won = await prisma.opportunity.aggregate({
    where: { dealStatus: "WON" },
    _count: true,
    _sum: { amount: true },
  });
  console.log(
    `수주 ${won._count}건 · ${Number(won._sum.amount ?? 0).toLocaleString()}원 / 전체 딜 ${await prisma.opportunity.count()}건`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

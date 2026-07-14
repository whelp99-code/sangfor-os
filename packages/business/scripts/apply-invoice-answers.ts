/**
 * 세금계산서 ↔ 딜 확정 — 대표 확인(세금계산서_확인요청_20260714.xlsx) 반영.
 *
 * 금액 규칙(대표 확인): 넥시아스 견적=매입가, 내가 보낸 견적=매출가, 견적과 세금계산서가
 * 다르면 **무조건 세금계산서**. 세금계산서의 상대는 최종고객이 아니라 파트너다.
 *
 * 근거는 세금계산서 + 프로젝트 폴더의 견적서 원본이다
 * (~/Documents/개인자료/법인 - 베를로/1. Project). 폴더명이 곧 딜이고, 그 안의 견적서가
 * 매출가다. 예: "202511 - 롯데건설 리뉴얼 - 2대" → 1,700,000 계산서 2장 = 3,400,000.
 *
 * 조선일보 계열은 여기서 건드리지 않는다 — 딜 4개가 겹쳐 있어(2025년 갱신·2026년 갱신)
 * 매핑을 잘못하면 매출이 이중계상된다. 대표 확인 후 별도 반영한다.
 *
 * Usage: tsx packages/business/scripts/apply-invoice-answers.ts [--apply]
 */
import { prisma } from "@sangfor/db";

const APPLY = process.argv.includes("--apply");

interface DealFix {
  /** 딜 제목(현재 DB). 없으면 title로 새로 만든다. */
  find: string;
  title?: string;
  customer?: string;
  partner?: string;
  amount: number;
  stage?: "WON" | "PROPOSAL" | "NEGOTIATION";
  won?: boolean;
  nextAction?: string;
  /** 이 딜로 흡수해 지울 중복 딜 제목 조각. */
  absorb?: string[];
  why: string;
}

const FIXES: DealFix[] = [
  {
    find: "일지테크 - Total infra",
    partner: "아지텍",
    amount: 167_000_000,
    stage: "WON",
    won: true,
    nextAction: "세금계산서 발행됨 — 잔금 40% 입금 확인",
    why: "아지텍 계산서 167,000,000 (대표 확인: '그 딜이 맞다'). 기존 14,280,000은 견적 일부만 잡힌 값",
  },
  {
    find: "인카금융서비스 - Sangfor 도입",
    partner: "JNG System",
    amount: 75_900_000,
    stage: "WON",
    won: true,
    nextAction: "입금 완료 — 정산 종결",
    why: "JNG System 계산서 75,900,000 (대표 확인: '인카금융그룹건'). 제이앤지시스템 aSV 견적 20250918과 발행일 2025-10 일치",
  },
  {
    find: "롯데건설 리뉴얼 - 2대",
    customer: "롯데건설",
    partner: "두올테크",
    amount: 3_400_000,
    stage: "WON",
    won: true,
    nextAction: "입금 완료 — 정산 종결",
    why: "NGAF 리뉴얼 2대 = 롯데건설(직판) 1,700,000 + 두올테크(하청) 1,700,000. Funnel 매출 3,400,000과 일치",
  },
  {
    find: "동국대학교 - VDI",
    title: "동국대학교병원 - VDI",
    customer: "동국대학교병원",
    partner: "아이티네이드",
    amount: 24_380_000,
    stage: "WON",
    won: true,
    nextAction: "세금계산서 발행됨 — 입금 확인(미수)",
    absorb: ["아이티네이드 - 간략 VDI 하드웨어", "동국대학교 aServer"],
    why: "아이티네이드 계산서 24,380,000 = 서버가격 + 상포 솔루션가격(대표 확인). 체인: 동국대병원 ← 아이티네이드 ← 투비컴텍 ← 베를로 ← 넥시아스&HC코퍼레이션",
  },
  {
    find: "[케이브이머티리얼즈] HCI 서버 유지보수 견적 검토 요청",
    title: "케이브이머티리얼즈 - HCI 서버 유지보수(12개월)",
    customer: "케이브이머티리얼즈",
    partner: "굿어스",
    amount: 13_560_000,
    stage: "WON",
    won: true,
    nextAction: "굿어스 12개월 분할 청구 — 매월 입금 확인",
    absorb: ["주식회사 베를로 유지보수 계약에 대한 자금"],
    why: "굿어스 계산서 13,560,000 (대표 확인: '이건이 맞다'). 매입은 넥시아스에 일시금, 매출은 굿어스가 12개월 분할",
  },
  {
    find: "부산도시가스공사 - aSV 기술지원",
    title: "부산도시가스공사 - aSV 기술지원",
    customer: "부산도시가스공사",
    partner: "일에이엔",
    amount: 7_000_000,
    stage: "WON",
    won: true,
    nextAction: "입금 완료 — 정산 종결",
    why: "일에이엔 계산서 7,000,000 = 기술지원료(대표 확인). hDR 딜(18,000,000)과 별건 — 폴더 '101. 기술지원/202602 - 부산도시가스공사 - aSV'",
  },
];

// 아지텍 계산서: 30%가 아니라 60% 입금됐다(대표 확인).
const DEPOSIT_FIX = { buyer: "아지텍", ratio: 0.6, memo: "대금 60% 입금" };

async function main() {
  console.log(`딜 확정 ${FIXES.length}건${APPLY ? "" : " (dry-run — --apply로 반영)"}\n`);

  const projectId = (await prisma.opportunity.findFirst({ select: { projectId: true } }))?.projectId;
  if (!projectId) throw new Error("projectId를 찾을 수 없다");

  for (const f of FIXES) {
    const existing = await prisma.opportunity.findFirst({
      where: { title: { contains: f.find } },
      select: { id: true, title: true, amount: true },
    });

    const customerId = f.customer
      ? (await prisma.customer.findFirst({ where: { name: f.customer } }))?.id ?? null
      : undefined;
    const partnerId = f.partner
      ? (await prisma.partner.findFirst({ where: { name: f.partner } }))?.id ?? null
      : undefined;

    if (f.customer && customerId === null) console.log(`  ⚠ 고객 없음: ${f.customer}`);
    if (f.partner && partnerId === null) console.log(`  ⚠ 파트너 없음: ${f.partner}`);

    const title = f.title ?? existing?.title ?? f.find;
    const before = existing?.amount == null ? "없음" : Number(existing.amount).toLocaleString();

    console.log(`■ ${title}`);
    console.log(`   ${existing ? `금액 ${before} → ` : "신규 생성 — 금액 "}${f.amount.toLocaleString()}원`);
    console.log(`   ${f.why}`);

    const data = {
      title,
      amount: f.amount,
      ...(customerId !== undefined ? { customerId } : {}),
      ...(partnerId !== undefined ? { partnerId } : {}),
      ...(f.stage ? { stage: f.stage } : {}),
      ...(f.won ? { dealStatus: "WON" as const } : {}),
      ...(f.nextAction ? { nextAction: f.nextAction } : {}),
    };

    if (APPLY) {
      const dealId = existing
        ? (await prisma.opportunity.update({ where: { id: existing.id }, data })).id
        : (await prisma.opportunity.create({ data: { ...data, projectId } })).id;

      // 중복 딜은 남겨두면 파이프라인이 같은 건을 두 번 센다.
      for (const frag of f.absorb ?? []) {
        const dups = await prisma.opportunity.findMany({
          where: { title: { contains: frag }, id: { not: dealId } },
          select: { id: true, title: true },
        });
        for (const d of dups) {
          console.log(`   흡수·삭제: ${d.title.slice(0, 54)}`);
          await prisma.opportunity.delete({ where: { id: d.id } });
        }
      }
    } else {
      for (const frag of f.absorb ?? []) {
        const dups = await prisma.opportunity.findMany({
          where: { title: { contains: frag } },
          select: { title: true },
        });
        for (const d of dups) console.log(`   흡수·삭제 예정: ${d.title.slice(0, 54)}`);
      }
    }
    console.log();
  }

  const inv = await prisma.invoice.findFirst({ where: { buyer: DEPOSIT_FIX.buyer } });
  if (inv) {
    const deposit = Math.round(inv.total * DEPOSIT_FIX.ratio);
    console.log(
      `■ ${DEPOSIT_FIX.buyer} 계산서 입금: ${inv.depositAmount?.toLocaleString() ?? "없음"} → ${deposit.toLocaleString()}원 (합계 ${inv.total.toLocaleString()}의 60%)`,
    );
    if (APPLY) {
      await prisma.invoice.update({
        where: { id: inv.id },
        data: { depositAmount: deposit, depositStatus: "부분", memo: DEPOSIT_FIX.memo },
      });
    }
  }

  if (!APPLY) return;
  const won = await prisma.opportunity.aggregate({
    where: { dealStatus: "WON" },
    _count: true,
    _sum: { amount: true },
  });
  console.log(
    `\n반영 후 — 수주 ${won._count}건, 합계 ${Number(won._sum.amount ?? 0).toLocaleString()}원 / 전체 딜 ${await prisma.opportunity.count()}건`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

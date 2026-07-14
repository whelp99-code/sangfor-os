/**
 * 입금은 통장이 정본이다 — finance_cashflows로 세금계산서 입금을 전면 재대조.
 *
 * 이걸 안 보고 "60% 입금"이라는 말만 듣고 total × 0.6을 계산해 아지텍 입금액을
 * 덮어썼다(110,220,000). 통장의 실제 입금은 2회 합계 119,380,800이다. 입금액은
 * 절대 비율로 계산하지 않는다 — 통장에 찍힌 금액만 쓴다.
 *
 * 통장 데이터는 2026-06-24까지다. 그 이후 입금은 CSV 재임포트 전까지 반영되지 않는다.
 *
 * 금액이 어긋난 두 건은 통장이 견적서 편을 들었다:
 *  - 디지틀조선일보: 통장 3,630,000 = 견적 공급가 3,300,000 + VAT. 계산서 행이
 *    공급가 3,300,000을 VAT 포함액으로 잘못 잡고 있었다(3,000,000 + 300,000).
 *  - 롯데건설: 견적서·두올테크 견적서 모두 1,700,000(VAT포함 1,870,000)인데 통장에는
 *    935,000만 들어왔다. 절반만 입금된 것이다 — 계산서 금액이 틀린 게 아니다.
 *
 * Usage: tsx packages/business/scripts/reconcile-bank-deposits.ts [--apply]
 */
import { prisma } from "@sangfor/db";

const APPLY = process.argv.includes("--apply");

interface Settle {
  /** 계산서 식별: buyer + 발행합계(total). 굿어스처럼 같은 금액이 여럿이면 memo로 좁힌다. */
  buyer: string;
  total: number;
  memo?: string;
  /** 통장에 찍힌 입금액. 0이면 미입금. */
  deposit: number;
  depositDate?: string;
  /** 계산서 금액 자체가 틀린 경우에만. */
  fixAmount?: { amount: number; vat: number; total: number };
  why: string;
}

const SETTLEMENTS: Settle[] = [
  {
    buyer: "아지텍",
    total: 183_700_000,
    deposit: 119_380_800,
    depositDate: "2026-05-29",
    why: "통장 2회: 2026-02-27 51,163,200 + 2026-05-29 68,217,600. 내가 계산한 60%(110,220,000)는 근거 없는 값이었다",
  },
  {
    buyer: "GSITM",
    total: 9_900_000,
    deposit: 9_900_000,
    depositDate: "2026-06-10",
    why: "통장 2026-06-10 9,900,000 입금 — 미수가 아니라 완납",
  },
  {
    buyer: "디지틀조선일보",
    total: 3_300_000,
    deposit: 3_630_000,
    depositDate: "2026-05-29",
    fixAmount: { amount: 3_300_000, vat: 330_000, total: 3_630_000 },
    why: "통장 3,630,000 = 견적 공급가 3,300,000 + VAT. 계산서 행이 300,000 과소 입력돼 있었다",
  },
  {
    buyer: "디지틀조선일보",
    total: 2_640_000,
    deposit: 2_640_000,
    depositDate: "2026-06-19",
    why: "통장 2026-06-19 2,640,000 입금 — 미수가 아니라 완납",
  },
  {
    buyer: "롯데건설",
    total: 1_870_000,
    deposit: 935_000,
    depositDate: "2026-02-03",
    why: "견적서·두올테크 견적서 모두 1,700,000(VAT포함 1,870,000)인데 통장엔 935,000만. 절반 미입금",
  },
  {
    buyer: "굿어스",
    total: 858_000,
    memo: "KV IAG 2회차 (EPO2602-011)",
    deposit: 858_000,
    depositDate: "2026-05-15",
    why: "통장 2026-05-15 858,000 (지급조건 익익월 15일)",
  },
  {
    buyer: "굿어스",
    total: 858_000,
    memo: "KV IAG 3회차 (EPO2602-011)",
    deposit: 858_000,
    depositDate: "2026-06-15",
    why: "통장 2026-06-15 858,000",
  },
];

interface SupportCase {
  counterparty: string;
  isPartner: boolean;
  customer: string;
  dealTitle: string;
  amount: number;
  depositDate: string;
  memo: string;
}

// 통장에는 입금이 있는데 세금계산서도 딜도 없던 건들. 대표 확인(2026-07-15): 둘 다 기술지원.
const SUPPORT: SupportCase[] = [
  {
    counterparty: "이너엔",
    isPartner: true,
    customer: "경희방송대",
    dealTitle: "경희방송대 - 기술지원",
    amount: 1_000_000,
    depositDate: "2026-03-25",
    memo: "경희방송대 기술지원 (이너엔 경유)",
  },
  {
    counterparty: "지티솔루션",
    isPartner: true,
    customer: "지티솔루션",
    dealTitle: "지티솔루션 - 웨비나 발표",
    amount: 2_000_000,
    depositDate: "2026-06-10",
    memo: "웨비나 발표 기술지원",
  },
];

async function main() {
  console.log(`통장 대조${APPLY ? "" : " (dry-run — --apply로 반영)"}\n`);

  for (const s of SETTLEMENTS) {
    const inv = await prisma.invoice.findFirst({
      where: { buyer: s.buyer, total: s.total, ...(s.memo ? { memo: s.memo } : {}) },
    });
    if (!inv) {
      console.log(`  ⚠ 계산서 없음: ${s.buyer} ${s.total.toLocaleString()}`);
      continue;
    }

    const total = s.fixAmount?.total ?? inv.total;
    const status = s.deposit >= total ? "완료" : s.deposit > 0 ? "부분" : "미수";

    console.log(`■ ${s.buyer} ${(s.memo ?? "").slice(0, 26)}`);
    if (s.fixAmount) {
      console.log(
        `   계산서 금액: ${inv.total.toLocaleString()} → ${s.fixAmount.total.toLocaleString()} (공급가 ${s.fixAmount.amount.toLocaleString()})`,
      );
    }
    console.log(
      `   입금 ${(inv.depositAmount ?? 0).toLocaleString()} → ${s.deposit.toLocaleString()}  [${inv.depositStatus} → ${status}]  잔액 ${(total - s.deposit).toLocaleString()}`,
    );
    console.log(`   ${s.why}\n`);

    if (!APPLY) continue;
    await prisma.invoice.update({
      where: { id: inv.id },
      data: {
        ...(s.fixAmount ?? {}),
        depositAmount: s.deposit,
        depositStatus: status,
        depositDate: s.depositDate ? new Date(s.depositDate) : null,
      },
    });
  }

  const projectId = (await prisma.opportunity.findFirst({ select: { projectId: true } }))!.projectId;
  // Invoice.projectId는 Project가 아니라 FinanceProject를 가리킨다. 딜의 projectId를 넣으면 FK가 깨진다.
  const financeProjectId = (await prisma.financeProject.findFirst({ select: { id: true } }))?.id ?? null;

  for (const c of SUPPORT) {
    const vat = Math.round(c.amount * 0.1);
    const total = c.amount + vat;
    console.log(`■ ${c.dealTitle}  ${c.amount.toLocaleString()}원 (통장 ${c.depositDate} ${total.toLocaleString()} 입금)`);
    console.log(`   ${c.memo} — 계산서·딜 신규 생성\n`);
    if (!APPLY) continue;

    const partnerId = c.isPartner
      ? ((await prisma.partner.findFirst({ where: { name: c.counterparty } })) ??
          (await prisma.partner.create({ data: { name: c.counterparty, projectId } }))).id
      : null;
    const customerId = (
      (await prisma.customer.findFirst({ where: { name: c.customer } })) ??
      (await prisma.customer.create({ data: { name: c.customer, projectId } }))
    ).id;

    if (!(await prisma.opportunity.findFirst({ where: { title: c.dealTitle } }))) {
      await prisma.opportunity.create({
        data: {
          projectId,
          title: c.dealTitle,
          customerId,
          partnerId,
          amount: c.amount,
          stage: "WON",
          dealStatus: "WON",
          closeDate: new Date(c.depositDate),
          nextAction: "입금 완료 — 정산 종결",
        },
      });
    }
    if (!(await prisma.invoice.findFirst({ where: { buyer: c.counterparty, total } }))) {
      await prisma.invoice.create({
        data: {
          projectId: financeProjectId,
          buyer: c.counterparty,
          amount: c.amount,
          vat,
          total,
          depositAmount: total,
          depositStatus: "완료",
          depositDate: new Date(c.depositDate),
          issueDate: new Date(c.depositDate),
          memo: c.memo,
        },
      });
    }
  }

  if (!APPLY) return;

  const invs = await prisma.invoice.findMany({ where: { total: { gt: 0 } } });
  const outstanding = invs
    .filter((i) => i.depositStatus !== "완료" && i.total - (i.depositAmount ?? 0) > 0)
    .reduce((s, i) => s + i.total - (i.depositAmount ?? 0), 0);
  console.log(
    `반영 후 — 계산서 ${invs.length}건 · 미수(잔액 합계) ${outstanding.toLocaleString()}원 (VAT 포함)`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

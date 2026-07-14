/**
 * 월 분할 계약의 세금계산서를 회차별로 쪼갠다 — 굿어스(KV머티리얼즈 유지보수).
 *
 * 계약 총액을 계산서 한 행에 넣으면 아직 발행하지도 않은 회차가 미수로 잡힌다.
 * 실제로 13,560,000 한 행 + 입금 2,948,000이었고, 그 입금액은 NGAF 라이선스
 * 1,900,000 + IAG 1회차 780,000의 VAT 포함 금액과 정확히 일치했다.
 *
 * 스케줄 근거 — 굿어스 구매포탈 메일(2026-06-23):
 *   EPO2602-011 IAG   2026-02-01~2027-01-31  월 780,000 × 12  지급 익익월 15일
 *   EPO2602-035 NGAF  2026-01-01~2026-12-31  라이선스 1,900,000 + 반기 700,000 × 2
 *   합계 12,660,000 = 두 계약금액과 일치.
 *
 * 발행 회차는 데이터로 알 수 없어 대표 확인(2026-07-15): IAG는 5회차(2~6월)까지
 * 발행, 7월분 미발행. 남은 발행 예정은 미수가 아니라 발행 대기다 — 계산서 행을
 * 만들지 않는다.
 *
 * 기존 13,560,000 행은 지우지 않고 0원 취소 행으로 남긴다. 그 숫자가 어디서
 * 입력됐는지 아직 모르고(계약 합계와 900,000 차이), 대표가 확인할 근거다.
 *
 * Usage: tsx packages/business/scripts/split-installment-invoices.ts [--apply]
 */
import { prisma } from "@sangfor/db";

const APPLY = process.argv.includes("--apply");

const BUYER = "굿어스";

interface Issued {
  label: string;
  amount: number;
  issueDate: string;
  paid: boolean;
}

const ISSUED: Issued[] = [
  { label: "KV NGAF 라이선스 (EPO2602-035)", amount: 1_900_000, issueDate: "2026-02-27", paid: true },
  { label: "KV IAG 1회차 (EPO2602-011)", amount: 780_000, issueDate: "2026-02-28", paid: true },
  { label: "KV IAG 2회차 (EPO2602-011)", amount: 780_000, issueDate: "2026-03-31", paid: false },
  { label: "KV IAG 3회차 (EPO2602-011)", amount: 780_000, issueDate: "2026-04-30", paid: false },
  { label: "KV IAG 4회차 (EPO2602-011)", amount: 780_000, issueDate: "2026-05-31", paid: false },
  { label: "KV IAG 5회차 (EPO2602-011)", amount: 780_000, issueDate: "2026-06-30", paid: false },
];

const PENDING = [
  "IAG 6회차 780,000 (2026-07-31 발행 예정)",
  "IAG 7~12회차 780,000 × 6 (2026-08 ~ 2027-01)",
  "NGAF 반기 기술지원 700,000 × 2",
];

const VOID_MEMO =
  "⚠ 취소 — 계약 총액을 한 행에 넣은 값(13,560,000). 실제 발행분은 회차별 행으로 분리함(2026-07-15). " +
  "이 숫자의 출처는 여전히 불명이다: 굿어스 계약 합계는 12,660,000(IAG 9,360,000 + NGAF 3,300,000)으로 900,000 차이. 대표 확인 필요.";

async function main() {
  console.log(`${BUYER} 분할 계산서 정리${APPLY ? "" : " (dry-run — --apply로 반영)"}\n`);

  const old = await prisma.invoice.findFirst({ where: { buyer: BUYER, amount: 13_560_000 } });
  const projectId = old?.projectId ?? null;

  console.log("발행된 계산서 (회차별 행):");
  let issuedTotal = 0;
  let paidTotal = 0;
  for (const i of ISSUED) {
    const vat = Math.round(i.amount * 0.1);
    issuedTotal += i.amount;
    if (i.paid) paidTotal += i.amount + vat;
    console.log(
      `  ${i.issueDate}  ${i.label.padEnd(32)} ${i.amount.toLocaleString().padStart(10)}원  ${i.paid ? "완료" : "미수"}`,
    );

    if (!APPLY) continue;
    const exists = await prisma.invoice.findFirst({ where: { buyer: BUYER, memo: i.label } });
    if (exists) continue;
    await prisma.invoice.create({
      data: {
        projectId,
        buyer: BUYER,
        amount: i.amount,
        vat,
        total: i.amount + vat,
        issueDate: new Date(i.issueDate),
        depositStatus: i.paid ? "완료" : "미수",
        depositAmount: i.paid ? i.amount + vat : 0,
        memo: i.label,
      },
    });
  }

  console.log(
    `\n  발행 누계 ${issuedTotal.toLocaleString()}원 · 입금 ${(paidTotal / 1.1).toLocaleString()}원 · 미수 ${(issuedTotal - paidTotal / 1.1).toLocaleString()}원`,
  );
  console.log("\n발행 대기 (미수 아님 — 계산서 행을 만들지 않는다):");
  for (const p of PENDING) console.log(`  ${p}`);

  if (old) {
    console.log(`\n기존 총액 행 ${Number(old.amount).toLocaleString()}원 → 0원 취소 처리 (대표 확인용으로 남김)`);
    if (APPLY) {
      await prisma.invoice.update({
        where: { id: old.id },
        data: { amount: 0, vat: 0, total: 0, depositAmount: 0, depositStatus: "미수", memo: VOID_MEMO },
      });
    }
  }

  if (!APPLY) return;
  const rows = await prisma.invoice.findMany({
    where: { buyer: BUYER },
    orderBy: { issueDate: "asc" },
    select: { amount: true, total: true, issueDate: true, depositStatus: true, memo: true },
  });
  console.log(`\n반영 후 ${BUYER} 계산서 ${rows.length}행:`);
  for (const r of rows) {
    console.log(
      `  ${r.issueDate?.toISOString().slice(0, 10) ?? "-"}  ${Number(r.amount).toLocaleString().padStart(10)}원  ${(r.depositStatus ?? "").padEnd(4)}  ${(r.memo ?? "").slice(0, 40)}`,
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

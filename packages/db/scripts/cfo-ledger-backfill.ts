/**
 * Ledger backfill — 이중원장(LedgerEntry) P&L 정합.
 *
 * 문제: `postInvoiceIssued/postInvoicePaid/postExpense`는 invoice/expense를
 * create/update할 때만 호출된다. 시드·CSV 임포트로 들어온 문서는 이 훅을 타지
 * 않아 원장에 미기표되고, 그 결과 `/ledger/pnl`(getProfitAndLoss)이 실매출과
 * 완전히 괴리된다(revenue ₩0, expenses 극소).
 *
 * 이 스크립트는 `LedgerService.backfillLedger()`를 호출해 미기표 문서를
 * idempotent하게 기표한다.
 *
 *   pnpm --filter @sangfor/db cfo:ledger-backfill
 *
 * 멱등: reference(=문서 id)로 기존 기표를 판정하므로 재실행 시 skip만 늘고
 * 이중기표는 발생하지 않는다.
 *
 * NOTE: LedgerService는 @sangfor/api에 있고 @sangfor/db는 이를 의존하지 않으므로
 * (순환 의존 방지) 상대 경로로 소스를 직접 로드한다. tsx가 워크스페이스 간 TS를
 * 해석한다. 서비스가 쓰는 prisma는 @sangfor/db에서 resolve된다.
 */
import { LedgerService } from "../../../apps/api/src/services/finance/ledger.service";

import { prisma } from "../src/index";

async function main() {
  const ledger = new LedgerService();

  const before = await ledger.getProfitAndLoss();
  console.log("── before ──────────────────────────────");
  console.log(`  revenue:   ₩${before.revenue.toLocaleString("ko-KR")}`);
  console.log(`  expenses:  ₩${before.expenses.toLocaleString("ko-KR")}`);
  console.log(`  netIncome: ₩${before.netIncome.toLocaleString("ko-KR")}`);

  const result = await ledger.backfillLedger();

  const after = await ledger.getProfitAndLoss();
  console.log("\n── backfill ────────────────────────────");
  console.log(`  invoicesPosted: ${result.invoicesPosted}`);
  console.log(`  expensesPosted: ${result.expensesPosted}`);
  console.log(`  skipped:        ${result.skipped}`);

  console.log("\n── after ───────────────────────────────");
  console.log(`  revenue:   ₩${after.revenue.toLocaleString("ko-KR")}`);
  console.log(`  expenses:  ₩${after.expenses.toLocaleString("ko-KR")}`);
  console.log(`  netIncome: ₩${after.netIncome.toLocaleString("ko-KR")}`);
  console.log(`  margin:    ${after.margin}%`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

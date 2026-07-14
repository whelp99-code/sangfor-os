/**
 * 딜 금액 확정 — 세금계산서가 정본이다.
 *
 * 대표 확인(2026-07-14):
 *  - 넥시아스가 보낸 견적서 = **매입가**. 딜의 공급가(매출)에 넣으면 안 된다.
 *  - 내가 보낸 메일의 견적서 = **매출가**.
 *  - 견적 금액과 세금계산서 금액이 다르면 **무조건 세금계산서 금액**으로 산정한다.
 *
 * 세금계산서의 buyer는 최종고객이 아니라 **파트너**다 — 베를로는 파트너에게 매출을
 * 일으키고 파트너가 최종고객에게 판다. 그래서 딜↔계산서는 파트너로 잇는다.
 *
 * 파트너에 딜이 여럿이면 어느 건인지 모른다. 금액이 정확히 일치하는 딜이 있으면 그 건,
 * 없으면 사람이 봐야 한다 — 추측으로 금액을 바꾸면 매출이 틀어진다.
 *
 * Usage: tsx packages/business/scripts/reconcile-deal-amounts.ts [--apply]
 */
import { prisma } from "@sangfor/db";

const APPLY = process.argv.includes("--apply");

async function main() {
  const invoices = await prisma.invoice.findMany({
    where: { total: { gt: 0 } },
    select: { id: true, buyer: true, amount: true, total: true, depositStatus: true, issueDate: true },
    orderBy: { issueDate: "desc" },
  });

  const deals = await prisma.opportunity.findMany({
    select: {
      id: true,
      title: true,
      amount: true,
      dealStatus: true,
      partner: { select: { name: true } },
    },
  });

  console.log(`세금계산서 ${invoices.length}건${APPLY ? "" : " (dry-run)"}\n`);

  let applied = 0;
  const review: string[] = [];

  for (const inv of invoices) {
    const buyer = (inv.buyer ?? "").trim();
    if (!buyer) continue;

    const supply = Number(inv.amount ?? 0);
    const candidates = deals.filter((d) => d.partner?.name === buyer);
    const label = `${buyer.padEnd(14)} ${supply.toLocaleString().padStart(12)}원 (${inv.depositStatus}, ${inv.issueDate?.toISOString().slice(0, 10) ?? "-"})`;

    if (candidates.length === 0) {
      review.push(`  ${label}  → 이 파트너에 딜이 없음`);
      continue;
    }

    // 금액이 그대로 맞는 딜이 있으면 그 건이다.
    const exact = candidates.filter((d) => Number(d.amount ?? -1) === supply);
    if (exact.length === 1) {
      console.log(`  ${label}\n     확정: ${exact[0].title.slice(0, 46)} (금액 일치)`);
      applied++;
      continue;
    }

    // 딜이 하나뿐이면 그 건이다 — 금액이 다르면 세금계산서로 덮는다.
    if (candidates.length === 1) {
      const d = candidates[0];
      const before = d.amount == null ? "없음" : Number(d.amount).toLocaleString();
      console.log(`  ${label}\n     ${d.title.slice(0, 46)}: ${before} → ${supply.toLocaleString()} (세금계산서 기준)`);
      applied++;
      if (APPLY) {
        await prisma.opportunity.update({ where: { id: d.id }, data: { amount: supply } });
      }
      continue;
    }

    review.push(
      `  ${label}  → 후보 딜 ${candidates.length}건: ${candidates.map((c) => c.title.slice(0, 20)).join(" / ")}`,
    );
  }

  console.log(`\n금액 확정 ${applied}건`);

  if (review.length) {
    console.log(`\n사람 확인 필요 ${review.length}건 (어느 딜인지 특정 불가 — 추측하지 않음):`);
    for (const r of review) console.log(r);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

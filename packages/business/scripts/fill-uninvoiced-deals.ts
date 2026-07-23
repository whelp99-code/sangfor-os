/**
 * 세금계산서가 없는 수주 딜 마무리 — 금액은 폴더의 내 견적서, 상태는 '세금계산서 미발행'.
 *
 * 대표 지시(2026-07-14): 세금계산서가 없으면 미발행으로 처리하고, 견적금액은 폴더에서 확인.
 * 금액 출처는 전부 내가 보낸 견적서(매출)다 — 넥시아스가 보낸 건 매입이라 쓰지 않는다.
 *
 *  ESTEC            5,550,000  100. Renewal/001. 진플러스/001. ESTEC/ESTEC Renewal - 20260506.pdf
 *  디알비동일         600,000  100. Renewal/001. 진플러스/002. DRB동일/DRB동일 Renewal - 20260501.pdf
 *  GS건설 DT팀 HCI  5,000,000  100. Renewal/002. GSITM/20260408 - GS건설 DT팀 - HCI 3 Nodes - 리뉴얼.pdf
 *
 * legacy_quote_mutator — dry-run by default; apply only with --apply-legacy-only.
 */
import { prisma } from "@sangfor/db";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const APPLY = process.argv.includes("--apply-legacy-only");

const UNINVOICED = "세금계산서 미발행 — 발행 필요";

const FILLS = [
  {
    find: "[리뉴얼] ESTEC 1년 리뉴얼 견적서 요청 건",
    title: "ESTEC - 1년 리뉴얼",
    customer: "ESTEC",
    partner: "진플러스",
    amount: 5_550_000,
    source: "ESTEC Renewal - 20260506.pdf (수신: 진플러스 김진봉 대표님)",
  },
  {
    find: "디알비동일 Sangfor Term License",
    title: "디알비동일 - Sangfor Term License 갱신",
    customer: "DRB동일",
    partner: "진플러스",
    amount: 600_000,
    source: "DRB동일 Renewal - 20260501.pdf (수신: 진플러스 김진봉 대표님)",
  },
  {
    find: "GS건설 디지털트윈팀 HCI 라이선스 공급(1Y)",
    customer: "GS건설",
    partner: "GSITM",
    amount: 5_000_000,
    source: "20260408 - GS건설 DT팀 - HCI 3 Nodes - 리뉴얼.pdf (수신: GSITM). GSITM 계약 49432",
  },
];

// 넥시아스가 보낸 매입 견적 스레드로 만들어진 딜이다. 같은 건의 매출 딜
// (GS건설 VDI 라이선스 공급 1Y, 9,000,000)이 따로 있으므로 두면 이중계상된다.
const PURCHASE_THREAD = "GS E&C Sangfor Renewal";

function redactIdentifier(id: string) {
  return `${id.slice(0, 6)}…`;
}

export function assertNoCanonicalQuoteMutation(quotes: ReadonlyArray<{ id: string; contentHash: string | null }>) {
  const canonical = quotes.filter((quote) => quote.contentHash !== null);
  if (canonical.length > 0) {
    throw new Error(`CANONICAL_QUOTE_IMMUTABLE: ${canonical.map((quote) => redactIdentifier(quote.id)).join(",")}`);
  }
}

async function preflightLegacyQuotes(opportunityId: string) {
  const quotes = await prisma.quote.findMany({
    where: { opportunityId },
    select: { id: true, contentHash: true },
  });
  const canonical = quotes.filter((quote) => quote.contentHash !== null);
  const legacy = quotes.filter((quote) => quote.contentHash === null);
  console.log(`[legacy_quote_mutator] canonical matches=${canonical.length} ids=${canonical.map((quote) => redactIdentifier(quote.id)).join(",") || "none"}`);
  console.log(`[legacy_quote_mutator] legacy matches=${legacy.length} ids=${legacy.map((quote) => redactIdentifier(quote.id)).join(",") || "none"}`);
  assertNoCanonicalQuoteMutation(quotes);
}

async function main() {
  const dup = await prisma.opportunity.findFirst({
    where: { title: { contains: PURCHASE_THREAD } },
    select: { id: true, title: true },
  });
  const keep = dup
    ? await prisma.opportunity.findFirst({
        where: { title: { contains: "GS건설 VDI 라이선스 공급(1Y)" } },
        select: { id: true },
      })
    : null;
  // This preflight is intentionally before every write in this script.
  if (dup && keep) await preflightLegacyQuotes(dup.id);

  console.log(`미발행 딜 마무리${APPLY ? "" : " (dry-run — --apply-legacy-only로 반영)"}\n`);

  for (const f of FILLS) {
    const deal = await prisma.opportunity.findFirst({
      where: { title: { contains: f.find } },
      select: { id: true, title: true, amount: true },
    });
    if (!deal) {
      console.log(`  ⚠ 딜 없음: ${f.find}`);
      continue;
    }

    let customerId = (await prisma.customer.findFirst({ where: { name: f.customer } }))?.id ?? null;
    const partnerId = (await prisma.partner.findFirst({ where: { name: f.partner } }))?.id ?? null;
    if (!customerId) console.log(`  (고객 '${f.customer}' 신규 생성)`);

    const before = deal.amount == null ? "금액없음" : Number(deal.amount).toLocaleString();
    console.log(`■ ${f.title ?? deal.title}`);
    console.log(`   ${before} → ${f.amount.toLocaleString()}원  ·  ${UNINVOICED}`);
    console.log(`   근거: ${f.source}`);
    console.log();

    if (!APPLY) continue;

    if (!customerId) {
      const projectId = (await prisma.opportunity.findFirst({ select: { projectId: true } }))!
        .projectId;
      customerId = (await prisma.customer.create({ data: { name: f.customer, projectId } })).id;
    }

    await prisma.opportunity.update({
      where: { id: deal.id },
      data: {
        ...(f.title ? { title: f.title } : {}),
        customerId,
        partnerId,
        amount: f.amount,
        nextAction: UNINVOICED,
      },
    });
  }

  if (dup) {
    console.log(`■ 삭제: ${dup.title.slice(0, 54)}`);
    console.log(
      `   넥시아스 발신 매입 견적 스레드(2026-02-05). 매출 딜 'GS건설 VDI 라이선스 공급(1Y)' 9,000,000이 같은 건이다`,
    );
    if (APPLY) {
      if (keep) {
        await prisma.quote.updateMany({
          where: { opportunityId: dup.id, contentHash: null },
          data: { opportunityId: keep.id },
        });
        const taken = await prisma.engagement.findUnique({ where: { opportunityId: keep.id } });
        if (!taken) {
          await prisma.engagement.updateMany({
            where: { opportunityId: dup.id },
            data: { opportunityId: keep.id },
          });
        }
      }
      await prisma.opportunity.delete({ where: { id: dup.id } });
    }
  }

  if (!APPLY) return;

  const won = await prisma.opportunity.findMany({
    where: { dealStatus: "WON" },
    select: { title: true, amount: true, nextAction: true },
    orderBy: { amount: "desc" },
  });
  const total = won.reduce((s, d) => s + Number(d.amount ?? 0), 0);
  const unissued = won.filter((d) => d.nextAction === UNINVOICED);
  console.log(`\n수주 ${won.length}건 · ${total.toLocaleString()}원`);
  console.log(
    `그중 세금계산서 미발행 ${unissued.length}건 · ${unissued.reduce((s, d) => s + Number(d.amount ?? 0), 0).toLocaleString()}원`,
  );
  for (const d of unissued) {
    console.log(`  ${d.title.padEnd(42)} ${Number(d.amount ?? 0).toLocaleString().padStart(11)}원`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main()
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}

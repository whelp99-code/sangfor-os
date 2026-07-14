/**
 * 딜 진행 판정 — 확인 회신이 아니라 "넥시아스 구매요청"으로.
 *
 * 이 회사에서는 고객의 확인 회신이 거의 오지 않는다(대표 확인). 실제 종결 신호는
 * 총판에 발주를 넣었는가다: 넥시아스로 보낸 메일에 "발주 부탁드립니다" / "발주 요청" /
 * "발주서를 전달"이 있으면 그 건은 실제로 진행된 것이다.
 *
 * 세금계산서까지 발행됐으면 정산 단계다. 둘을 대조해 딜의 실제 위치를 판정한다.
 *
 * Usage: tsx packages/business/scripts/reconcile-purchase-orders.ts [--apply]
 */
import { prisma } from "@sangfor/db";

import { normalizeDealTitle } from "../src/crm/deal-title";

const APPLY = process.argv.includes("--apply");

// 베를로가 발주를 넣는 상대 = 상위 공급선.
const SUPPLIERS = ["nexias.co.kr", "syinet.com", "hyosung.com"];

// 내가 발주를 넣었다는 표현. 받은 견적을 전달만 한 것과 구분해야 한다.
const PO_SIGNALS = [/발주\s*부탁/, /발주\s*요청/, /발주서를?\s*전달/, /발주를?\s*진행/];

interface PurchaseOrder {
  date: Date;
  subject: string;
  body: string;
  conversationId: string | null;
}

function isPurchaseOrder(body: string): boolean {
  return PO_SIGNALS.some((re) => re.test(body));
}

// 발주 메일 제목은 최종고객과 제품을 함께 적는다("ESTEC Sangfor Term License",
// "GS건설 DT팀 HCI 라이센스 리뉴얼"). 둘 다 맞아야 같은 건으로 본다.
//
// 고객명만으로 매칭하면 안 된다 — GS건설처럼 딜이 여럿인 고객에서 발주 1건이 전 딜을
// 수주로 만든다(실제로 그렇게 오판했다). 제목 조각도 안 된다: "[넥시아스] 베를" 같은
// 말머리가 모든 메일에 공통이라 전부 걸린다.
// 같은 제품·행위를 다르게 부른다. aDesk가 Sangfor의 VDI 제품이고, Term License
// Extension이 곧 리뉴얼이다. 이걸 모르면 같은 건을 다른 건으로 본다.
const PRODUCT_GROUPS: Record<string, string[]> = {
  vdi: ["VDI", "aDesk"],
  hci: ["HCI"],
  asv: ["aSV"],
  ngaf: ["NGAF"],
  iag: ["IAG"],
  sase: ["SASE"],
  asec: ["aSEC"],
  aserver: ["aServer"],
  vgpu: ["vGPU"],
  renewal: ["Renewal", "리뉴얼", "Term License", "Term-License", "Extension", "갱신", "연장"],
  server: ["서버"],
};

// 딜 제목은 메일 제목을 normalizeDealTitle로 정리해 만든 것이다. 발주 메일 제목을 같은
// 방식으로 정리하면 같은 건은 서로를 포함한다 — 고객+제품만 보면 "GS건설 HCI"가 여러 건에
// 걸려 엉뚱한 딜을 수주로 만든다(실제로 그랬다).
function sameCase(poSubject: string, dealTitle: string): boolean {
  const a = normalizeDealTitle(poSubject).title.replace(/\s+/g, "");
  const b = normalizeDealTitle(dealTitle).title.replace(/\s+/g, "");
  if (a.length < 15 || b.length < 15) return false;
  return a.includes(b) || b.includes(a);
}

// 발주 메일 제목은 "[넥시아스] 베를로 - {회사} {제품} 견적" 꼴이다. 회사명을 뽑아
// 같은 건의 딜을 찾는다 — 딜은 다른 스레드(고객 요청)에서 생겨 제목이 다를 수 있다.
function companyInOrder(subject: string): string | null {
  const t = normalizeDealTitle(subject).title;
  const m = t.match(/베를로\s*[-–]\s*([^\s]+(?:\s[^\s]+)?)/);
  if (!m) return null;
  return m[1].replace(/(Sangfor|HCI|VDI|aSV|Term).*$/i, "").trim() || null;
}

function productsIn(text: string): Set<string> {
  const found = new Set<string>();
  for (const [group, words] of Object.entries(PRODUCT_GROUPS)) {
    if (words.some((w) => new RegExp(w.replace(/-/g, "[- ]?"), "i").test(text))) found.add(group);
  }
  return found;
}

function sharesProduct(a: string, b: string): boolean {
  const pa = productsIn(a);
  if (pa.size === 0) return false;
  for (const p of productsIn(b)) if (pa.has(p)) return true;
  return false;
}

async function main() {
  const mails = await prisma.mailMessage.findMany({
    where: { direction: "outbound", body: { not: null } },
    select: { subject: true, body: true, toEmail: true, receivedAt: true, conversationId: true },
    orderBy: { receivedAt: "asc" },
  });

  const orders: PurchaseOrder[] = mails
    .filter(
      (m) =>
        SUPPLIERS.some((s) => (m.toEmail ?? "").includes(s)) && isPurchaseOrder(m.body ?? ""),
    )
    .map((m) => ({
      date: m.receivedAt ?? new Date(0),
      subject: m.subject,
      body: m.body ?? "",
      conversationId: m.conversationId,
    }));

  console.log(`총판 발주 요청 ${orders.length}건 발견${APPLY ? "" : " (dry-run)"}\n`);
  for (const o of orders) {
    console.log(`  ${o.date.toISOString().slice(0, 10)}  ${o.subject.slice(0, 62)}`);
  }

  const deals = await prisma.opportunity.findMany({
    select: {
      id: true,
      title: true,
      stage: true,
      dealStatus: true,
      amount: true,
      customer: { select: { name: true } },
    },
  });
  const invoices = await prisma.invoice.findMany({
    select: { buyer: true, total: true, depositStatus: true },
  });


  console.log(`\n${"─".repeat(78)}\n딜 대조\n`);

  const customerNames = (await prisma.customer.findMany({ select: { name: true } }))
    .map((c) => c.name)
    .filter((n) => n.length >= 2);

  // 딜의 고객은 제목에도 있다(customer_id가 비어 있어도). 둘 다 본다.
  const subjectOf = (d: (typeof deals)[number]) => `${d.title} ${d.customer?.name ?? ""}`;

  let advanced = 0;
  const usedOrders = new Set<string>();
  for (const deal of deals) {
    if (deal.dealStatus === "WON" || deal.dealStatus === "LOST") continue;

    const dealText = subjectOf(deal);
    // 딜 제목의 회사명과 고객 행의 이름이 다를 수 있다(딜 "디알비동일" vs 고객 "DRB동일").
    // 그래서 고객명은 세금계산서 대조에만 쓰고, 건 식별은 제목 대조로 한다.
    const names = customerNames.filter((n) => dealText.includes(n));

    let matched = orders.filter((o) => sameCase(o.subject, deal.title));

    // 제목이 다르면(딜은 고객 요청 스레드, 발주는 총판 스레드) 회사+제품으로 잇는다.
    // 단 후보 딜이 정확히 하나일 때만 — 여럿이면 어느 건인지 모른다.
    if (matched.length === 0) {
      matched = orders.filter((o) => {
        const company = companyInOrder(o.subject);
        if (!company || company.length < 2 || !deal.title.includes(company)) return false;
        if (!sharesProduct(o.subject, deal.title)) return false;
        const rivals = deals.filter(
          (x) =>
            x.id !== deal.id &&
            x.dealStatus !== "WON" &&
            x.dealStatus !== "LOST" &&
            x.title.includes(company) &&
            sharesProduct(o.subject, x.title),
        );
        return rivals.length === 0;
      });
    }
    if (matched.length === 0) continue;

    const customer = names[0] ?? "";
    const latest = matched[matched.length - 1];
    // 고객명이 없으면 세금계산서를 붙이지 않는다 — "".includes("")가 전부 참이라
    // 남의 계산서가 붙는다(실제로 아지텍 계산서가 디알비동일 딜에 붙었다).
    const invoice = customer ? invoices.find((i) => (i.buyer ?? "").includes(customer)) : undefined;

    const verdict = invoice
      ? `수주 + 세금계산서(${invoice.depositStatus}, ${Number(invoice.total).toLocaleString()}원)`
      : "수주 (세금계산서 전)";

    console.log(`  ${deal.title.slice(0, 42).padEnd(44)} ${verdict}`);
    console.log(`     발주: ${latest.date.toISOString().slice(0, 10)} ${latest.subject.slice(0, 54)}`);
    matched.forEach((m) => usedOrders.add(m.subject));
    advanced++;

    if (APPLY) {
      await prisma.opportunity.update({
        where: { id: deal.id },
        data: {
          stage: "WON",
          dealStatus: "WON",
          closeDate: latest.date,
          nextAction: invoice ? "세금계산서 발행됨 — 입금 확인" : "총판 발주 완료 — 세금계산서 발행 필요",
        },
      });
    }
  }

  console.log(`\n발주 근거로 수주 판정: ${advanced}건`);

  // 매칭 안 된 발주를 조용히 버리면 "전부 처리했다"로 읽힌다. 딜이 없거나 제목이
  // 달라 못 이은 건이므로 사람이 봐야 한다.
  const orphanOrders = orders.filter((o) => !usedOrders.has(o.subject));
  if (orphanOrders.length) {
    console.log(`\n딜과 잇지 못한 발주 ${orphanOrders.length}건 (확인 필요):`);
    for (const o of orphanOrders) {
      console.log(`  ${o.date.toISOString().slice(0, 10)}  ${o.subject.slice(0, 62)}`);
    }
  }

  if (!APPLY) return;
  const after = await prisma.opportunity.groupBy({ by: ["dealStatus"], _count: true });
  console.log("\n반영 후 딜 상태:");
  for (const g of after) console.log(`  ${g.dealStatus}: ${g._count}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

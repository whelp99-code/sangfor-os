/**
 * berllo-crm-import — load real deals (parsed from the 베를로 project folder) into
 * the CRM (Customer / Opportunity / Engagement), and link real finance invoices
 * where the buyer name matches an end customer.
 *
 * DRY-RUN by default (no writes). Pass --apply to persist.
 *   pnpm --filter @sangfor/db exec tsx scripts/berllo-crm-import.ts
 *   pnpm --filter @sangfor/db exec tsx scripts/berllo-crm-import.ts --apply
 *
 * Source: packages/db/.cfo-backup/berllo-deals.json (gitignored — real business
 * data). Produced by parsing the "법인 - 베를로/1. Project" folder (folder name →
 * {stage, yearMonth, customer, product, partner}).
 *
 * Idempotent: an opportunity is keyed by (projectId, title); re-runs skip existing.
 * Non-destructive: only creates/links, never deletes the existing (seed/test) rows.
 *
 * Stage mapping (folder status → CRM):
 *   WON     → stage WON,          dealStatus WON      (+ Engagement)
 *   LOST    → stage LOST,         dealStatus LOST     (lostReason=folder)
 *   STALLED → stage NEGOTIATION,  dealStatus ON_HOLD
 *   ACTIVE  → stage PROPOSAL,     dealStatus OPEN
 *   RENEWAL → stage QUALIFIED,    dealStatus OPEN,   dealType RENEWAL
 *   SUPPORT → skipped (not a sales opportunity; logged)
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { prisma } from "../src/index";

const APPLY = process.argv.includes("--apply");
const PROJECT_ID = "demo";

type Deal = { stage: string; yearMonth: string | null; customer: string; product: string | null; partner: string | null; rawName: string };

// macOS folder names (via codex) arrive in NFD (decomposed jamo); compose to NFC
// first so [가-힣] and substring ops work. Then whitelist to hangul+alphanumerics.
const nfc = (s: string | null | undefined) => (s ?? "").normalize("NFC");
const norm = (s: string | null | undefined) =>
  nfc(s).toLowerCase().replace(/[^가-힣a-z0-9]/g, "");

// Display name cleanup: drop a trailing "리뉴얼 …" tail + parenthetical partner
// that a few folder names fold into the customer (e.g. "롯데건설 리뉴얼" → "롯데건설",
// "금강철강(한길)" → "금강철강").
const cleanCustomer = (c: string) => nfc(c).replace(/[^가-힣A-Za-z0-9 ].*$/g, "").replace(/\s*리뉴얼.*$/, "").trim() || nfc(c).trim();
// Finance link = EXACT normalized name match only. Channel names differ (folder =
// end customer, finance = billed partner), so fuzzy containment over-matches; keep
// only trustworthy exact links (e.g. 롯데건설, GSITM, 디지털조선).

function mapStage(stage: string): { stage: string; dealStatus: string; dealType: string; lostReason: string | null; nextAction: string | null } {
  switch (stage) {
    case "WON":     return { stage: "WON",         dealStatus: "WON",    dealType: "NEW_BUILD", lostReason: null, nextAction: null };
    case "LOST":    return { stage: "LOST",        dealStatus: "LOST",   dealType: "NEW_BUILD", lostReason: "folder:3.Failed", nextAction: null };
    case "STALLED": return { stage: "NEGOTIATION", dealStatus: "ON_HOLD",dealType: "NEW_BUILD", lostReason: null, nextAction: "연기(stalled)" };
    case "RENEWAL": return { stage: "QUALIFIED",   dealStatus: "OPEN",   dealType: "RENEWAL",   lostReason: null, nextAction: null };
    default:        return { stage: "PROPOSAL",    dealStatus: "OPEN",   dealType: "NEW_BUILD", lostReason: null, nextAction: null };
  }
}

async function main() {
  const here = dirname(fileURLToPath(import.meta.url));
  const deals: Deal[] = JSON.parse(readFileSync(join(here, "..", ".cfo-backup", "berllo-deals.json"), "utf8"));

  // Finance invoices for end-customer amount linking.
  const invoices = await prisma.invoice.findMany({ where: { buyer: { not: null } }, select: { id: true, buyer: true, amount: true, engagementId: true } });
  const invByBuyer = new Map<string, { id: string; amount: number }[]>();
  for (const inv of invoices) {
    const k = norm(inv.buyer);
    (invByBuyer.get(k) ?? invByBuyer.set(k, []).get(k)!).push({ id: inv.id, amount: inv.amount });
  }

  // Existing opportunities (idempotency) + customers (reuse).
  const existingOpps = new Set((await prisma.opportunity.findMany({ select: { title: true } })).map((o) => o.title));
  const customerCache = new Map<string, string>(); // norm(name) -> customerId

  async function upsertCustomer(name: string): Promise<string> {
    const k = norm(name);
    if (customerCache.has(k)) return customerCache.get(k)!;
    const found = await prisma.customer.findFirst({ where: { projectId: PROJECT_ID, name } });
    let id = found?.id;
    if (!id) {
      if (APPLY) id = (await prisma.customer.create({ data: { projectId: PROJECT_ID, name } })).id;
      else id = `(new:${name})`;
    }
    customerCache.set(k, id);
    return id;
  }

  const summary = { created: 0, skipped: 0, support: 0, linkedInvoices: 0, engagements: 0 };
  const plan: string[] = [];

  for (const d of deals) {
    if (d.stage === "SUPPORT") { summary.support++; plan.push(`  ⏭  SUPPORT (skip): ${d.rawName}`); continue; }
    const title = nfc(`${d.customer} - ${d.product ?? d.stage}`).trim();
    if (existingOpps.has(title)) { summary.skipped++; continue; }

    const m = mapStage(d.stage);
    // A deal is a renewal if its folder name says so, regardless of status folder.
    if (/리뉴얼/.test(d.rawName)) m.dealType = "RENEWAL";
    const customerName = cleanCustomer(d.customer);
    const customerId = await upsertCustomer(customerName);
    const dealKey = norm(customerName);
    const matched = invByBuyer.get(dealKey) ?? [];
    const amount = matched.reduce((s, i) => s + i.amount, 0) || null;
    const closeDate = d.yearMonth ? new Date(`${d.yearMonth}-01T00:00:00Z`) : null;

    plan.push(`  ✅ ${d.stage.padEnd(7)} ${title}${amount ? `  ₩${amount.toLocaleString()}` : ""}${matched.length ? `  (invoice×${matched.length})` : ""}`);

    if (APPLY) {
      const opp = await prisma.opportunity.create({
        data: {
          projectId: PROJECT_ID, title, customerId,
          stage: m.stage as any, dealStatus: m.dealStatus as any, dealType: m.dealType,
          amount: amount ?? undefined, closeDate: closeDate ?? undefined,
          lostReason: m.lostReason ?? undefined, nextAction: m.nextAction ?? undefined,
        },
      });
      if (d.stage === "WON") {
        const eng = await prisma.engagement.create({ data: { opportunityId: opp.id, name: title, customerId, status: "completed", amount: amount ?? undefined } });
        summary.engagements++;
        // Deal backfill: link matching finance invoices to this engagement (only if not already linked).
        for (const inv of matched) {
          const cur = invoices.find((i) => i.id === inv.id);
          if (cur && !cur.engagementId) { await prisma.invoice.update({ where: { id: inv.id }, data: { engagementId: eng.id } }); summary.linkedInvoices++; }
        }
      }
    } else if (matched.length && d.stage === "WON") {
      summary.linkedInvoices += matched.filter((im) => !invoices.find((i) => i.id === im.id)?.engagementId).length;
    }
    summary.created++;
  }

  console.log(`\n=== 베를로 CRM import (${APPLY ? "APPLY" : "DRY-RUN"}) ===`);
  console.log(plan.join("\n"));
  console.log(`\ncreated opps: ${summary.created} · skipped(existing): ${summary.skipped} · support skipped: ${summary.support}`);
  console.log(`engagements(WON): ${summary.engagements} · finance invoices linked: ${summary.linkedInvoices}`);
  if (!APPLY) console.log("→ re-run with --apply to persist.\n");
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());

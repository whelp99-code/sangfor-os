/**
 * berllo-enrich — fill real quote amounts onto the imported opportunities using
 * the financials extracted from the 베를로 folder (quote spreadsheets / PDFs).
 *
 * DRY-RUN by default; --apply to persist.
 *   pnpm --filter @sangfor/db exec tsx scripts/berllo-enrich.ts [--apply]
 *
 * Join is deterministic (no fuzzy name matching): financials[].dealFolder ==
 * deals[].rawName → reconstruct the opportunity title (same rule as the import)
 * → find the opportunity → set amount ONLY where it is currently null (so real
 * finance-linked amounts are never overwritten). Idempotent.
 *
 * Sources (gitignored, real business data):
 *   .cfo-backup/berllo-financials.json  (extracted by the folder extractor)
 *   .cfo-backup/berllo-deals.json        (folder-name inventory)
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { prisma } from "../src/index";

const APPLY = process.argv.includes("--apply");
const nfc = (s: string | null | undefined) => (s ?? "").normalize("NFC");
const key = (s: string) => nfc(s).toLowerCase().replace(/[^가-힣a-z0-9]/g, "");

type Deal = { stage: string; customer: string; product: string | null; rawName: string };
type Fin = { dealFolder: string; customer: string; quoteAmountKRW: number | null; products: string[] };

async function main() {
  const bk = join(dirname(fileURLToPath(import.meta.url)), "..", ".cfo-backup");
  const deals: Deal[] = JSON.parse(readFileSync(join(bk, "berllo-deals.json"), "utf8"));
  const fins: Fin[] = JSON.parse(readFileSync(join(bk, "berllo-financials.json"), "utf8"));

  // rawName(folder) → reconstructed opportunity title (same rule as berllo-crm-import).
  const titleByFolder = new Map<string, string>();
  for (const d of deals) titleByFolder.set(key(d.rawName), nfc(`${d.customer} - ${d.product ?? d.stage}`).trim());

  const opps = await prisma.opportunity.findMany({ select: { id: true, title: true, amount: true } });
  const oppByTitle = new Map(opps.map((o) => [key(o.title), o]));

  // Data-quality guard: the extractor's "largest money cell" heuristic grabbed
  // template sample values (identical huge amounts repeated across many deals).
  // Reject amounts that (a) repeat across ≥3 deals (template artifact) or
  // (b) exceed 500M KRW (implausible for these SMB Sangfor quotes).
  const CAP = 500_000_000;
  const freq = new Map<number, number>();
  for (const f of fins) if (f.quoteAmountKRW != null) freq.set(f.quoteAmountKRW, (freq.get(f.quoteAmountKRW) ?? 0) + 1);
  const trustworthy = (a: number) => a > 0 && a <= CAP && (freq.get(a) ?? 0) < 3;

  let updated = 0, alreadySet = 0, noAmount = 0, noMatch = 0, rejected = 0;
  const plan: string[] = [];
  for (const f of fins) {
    if (f.quoteAmountKRW == null) { noAmount++; continue; }
    if (!trustworthy(f.quoteAmountKRW)) { rejected++; plan.push(`  ⏭  reject(품질): ${f.dealFolder} ₩${f.quoteAmountKRW.toLocaleString()}`); continue; }
    const title = titleByFolder.get(key(f.dealFolder));
    const opp = title ? oppByTitle.get(key(title)) : undefined;
    if (!opp) { noMatch++; plan.push(`  ⚠ no opp for folder: ${f.dealFolder}`); continue; }
    if (opp.amount != null) { alreadySet++; continue; }
    plan.push(`  ✅ ${opp.title}  → ₩${f.quoteAmountKRW.toLocaleString()}`);
    if (APPLY) await prisma.opportunity.update({ where: { id: opp.id }, data: { amount: f.quoteAmountKRW } });
    updated++;
  }

  console.log(`\n=== 베를로 enrich (${APPLY ? "APPLY" : "DRY-RUN"}) ===`);
  console.log(plan.join("\n"));
  console.log(`\namount 채움: ${updated} · 이미있음(보존): ${alreadySet} · 품질reject: ${rejected} · 추출금액없음: ${noAmount} · opp매칭실패: ${noMatch}`);
  if (!APPLY) console.log("→ --apply 로 반영\n");
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());

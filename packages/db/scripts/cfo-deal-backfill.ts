/**
 * Phase 2 backfill — write engagementId onto finance rows from the reviewed
 * reconciliation output. (ADR-001; anchor = Engagement.)
 *
 * DRY-RUN by default (writes nothing). Pass --apply to persist.
 *
 *   pnpm --filter @sangfor/db cfo:backfill            # dry-run preview
 *   pnpm --filter @sangfor/db cfo:backfill --apply    # actually write
 *
 * Reads the proposals produced by `cfo:reconcile`:
 *   packages/db/.cfo-backup/cfo-deal-reconcile.json
 *
 * Only auto-applies UNAMBIGUOUS mappings (verdict STRONG or MATCH — exactly one
 * candidate engagement). AMBIGUOUS / UNMATCHED finance projects are skipped and
 * listed so a human can resolve them (re-run reconcile after fixing names, or
 * supply a manual decisions file — future work).
 *
 * Idempotent: only rows where engagement_id IS NULL are touched, so re-running
 * never double-writes. FinanceProject is left intact (Phase 3 retires it).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { prisma } from "../src/index";

type Candidate = { id: string; name: string; clientAgrees: boolean };
type Proposal = {
  financeProjectId: string;
  financeProjectName: string;
  verdict: "STRONG" | "MATCH" | "AMBIGUOUS" | "UNMATCHED";
  candidates: Candidate[];
};

const APPLY = process.argv.includes("--apply");

function pickEngagement(p: Proposal): string | null {
  if (p.verdict === "STRONG" || p.verdict === "MATCH") {
    // STRONG/MATCH guarantee a single accepted candidate (client-agreeing one
    // for STRONG-by-disambiguation, else the sole candidate).
    const agreeing = p.candidates.filter((c) => c.clientAgrees);
    if (agreeing.length === 1) return agreeing[0].id;
    if (p.candidates.length === 1) return p.candidates[0].id;
  }
  return null;
}

async function main() {
  const here = dirname(fileURLToPath(import.meta.url));
  const reportPath = join(here, "..", ".cfo-backup", "cfo-deal-reconcile.json");

  let proposals: Proposal[];
  try {
    proposals = JSON.parse(readFileSync(reportPath, "utf8")).proposals;
  } catch {
    console.error(
      `reconcile report not found: ${reportPath}\n→ run \`pnpm --filter @sangfor/db cfo:reconcile\` first.`,
    );
    process.exitCode = 1;
    return;
  }

  const accepted: { fpId: string; fpName: string; engagementId: string }[] = [];
  const skipped: Proposal[] = [];
  for (const p of proposals) {
    const engagementId = pickEngagement(p);
    if (engagementId) accepted.push({ fpId: p.financeProjectId, fpName: p.financeProjectName, engagementId });
    else skipped.push(p);
  }

  console.log(`\nmode: ${APPLY ? "APPLY (writing)" : "DRY-RUN (no writes)"}`);
  console.log(`accepted mappings: ${accepted.length} · skipped: ${skipped.length}\n`);

  let totInv = 0, totExp = 0, totCf = 0;
  for (const m of accepted) {
    const where = { projectId: m.fpId, engagementId: null } as const;
    if (APPLY) {
      const [inv, exp, cf] = await prisma.$transaction([
        prisma.invoice.updateMany({ where, data: { engagementId: m.engagementId } }),
        prisma.expense.updateMany({ where, data: { engagementId: m.engagementId } }),
        prisma.cashflow.updateMany({ where, data: { engagementId: m.engagementId } }),
      ]);
      totInv += inv.count; totExp += exp.count; totCf += cf.count;
      console.log(`  ✅ ${m.fpName} → ${m.engagementId}  (inv ${inv.count} / exp ${exp.count} / cf ${cf.count})`);
    } else {
      const [inv, exp, cf] = await Promise.all([
        prisma.invoice.count({ where }),
        prisma.expense.count({ where }),
        prisma.cashflow.count({ where }),
      ]);
      totInv += inv; totExp += exp; totCf += cf;
      console.log(`  • ${m.fpName} → ${m.engagementId}  (inv ${inv} / exp ${exp} / cf ${cf})`);
    }
  }

  if (skipped.length) {
    console.log(`\nskipped (needs human resolution):`);
    for (const p of skipped) console.log(`  ⚠️  ${p.financeProjectName} [${p.verdict}] — ${p.candidates.length} candidate(s)`);
  }

  console.log(
    `\n${APPLY ? "updated" : "would update"}: invoices ${totInv} · expenses ${totExp} · cashflows ${totCf}`,
  );
  if (!APPLY) console.log("→ re-run with --apply to persist.\n");
  else console.log("→ done. FinanceProject left intact (Phase 3 retires it).\n");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

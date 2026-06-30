/**
 * DRY-RUN reconciliation — propose FinanceProject → Engagement mappings.
 *
 * READ-ONLY: this script writes NOTHING to the database. It only proposes
 * candidate links so a human can review before the real backfill. (ADR-001
 * Phase 1; anchor = Engagement.)
 *
 *   pnpm --filter @sangfor/db cfo:reconcile
 *
 * Output (gitignored — contains private financial data, do NOT commit):
 *   packages/db/.cfo-backup/cfo-deal-reconcile.md
 *   packages/db/.cfo-backup/cfo-deal-reconcile.json
 *
 * Matching strategy (reuses the cashflows normName heuristic):
 *   1. primary  — normName(FinanceProject.name) vs normName(Engagement.name)
 *                 and normName(Opportunity.title)
 *   2. secondary — normName(FinanceProject.client) vs normName(Customer.name)
 *                  (raises confidence / disambiguates multiple candidates)
 *
 * Classification:
 *   STRONG    — exactly one engagement matched by name AND client agrees
 *   MATCH     — exactly one engagement matched by name
 *   AMBIGUOUS — multiple engagements matched (needs human pick)
 *   UNMATCHED — no engagement matched (finance stays in "미배정" bucket)
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { prisma } from "../src/index";

// Same normalization used by cashflows.service.ts for counterparty↔project.
function normName(s: string | null | undefined): string {
  return (s ?? "").replace(/\(주\)|주식회사|㈜|\s|\.|,|-/g, "").toLowerCase();
}

type EngRef = { id: string; name: string; title: string; customer: string | null };
type Verdict = "STRONG" | "MATCH" | "AMBIGUOUS" | "UNMATCHED";

type Proposal = {
  financeProjectId: string;
  financeProjectName: string;
  client: string | null;
  invoiceCount: number;
  expenseCount: number;
  cashflowCount: number;
  revenue: number;
  cost: number;
  verdict: Verdict;
  candidates: { id: string; name: string; clientAgrees: boolean }[];
};

function pushTo(map: Map<string, EngRef[]>, key: string, val: EngRef) {
  if (!key) return;
  const arr = map.get(key);
  if (arr) arr.push(val);
  else map.set(key, [val]);
}

async function main() {
  const [projects, engagements, invAgg, expAgg, cfCount] = await Promise.all([
    prisma.financeProject.findMany({
      select: { id: true, name: true, client: true },
      orderBy: { name: "asc" },
    }),
    prisma.engagement.findMany({
      select: {
        id: true,
        name: true,
        opportunity: { select: { title: true, customer: { select: { name: true } } } },
      },
    }),
    prisma.invoice.groupBy({ by: ["projectId"], _sum: { amount: true }, _count: true }),
    prisma.expense.groupBy({ by: ["projectId"], _sum: { amount: true }, _count: true }),
    prisma.cashflow.groupBy({ by: ["projectId"], _count: true }),
  ]);

  const engRefs: EngRef[] = engagements.map((e) => ({
    id: e.id,
    name: e.name,
    title: e.opportunity?.title ?? "",
    customer: e.opportunity?.customer?.name ?? null,
  }));

  // Lookup maps keyed by normalized engagement name and opportunity title.
  const byName = new Map<string, EngRef[]>();
  for (const e of engRefs) {
    pushTo(byName, normName(e.name), e);
    pushTo(byName, normName(e.title), e);
  }

  const invByProj = new Map(invAgg.map((r) => [r.projectId, { sum: r._sum.amount ?? 0, count: r._count }]));
  const expByProj = new Map(expAgg.map((r) => [r.projectId, { sum: r._sum.amount ?? 0, count: r._count }]));
  const cfByProj = new Map(cfCount.map((r) => [r.projectId, r._count]));

  const proposals: Proposal[] = projects.map((p) => {
    const found = byName.get(normName(p.name)) ?? [];
    // Dedupe candidates by engagement id.
    const uniq = new Map<string, EngRef>();
    for (const e of found) uniq.set(e.id, e);
    const cands = [...uniq.values()].map((e) => ({
      id: e.id,
      name: e.name,
      clientAgrees: !!p.client && !!e.customer && normName(p.client) === normName(e.customer),
    }));

    let verdict: Verdict;
    if (cands.length === 0) verdict = "UNMATCHED";
    else if (cands.length === 1) verdict = cands[0].clientAgrees ? "STRONG" : "MATCH";
    else {
      const agreeing = cands.filter((c) => c.clientAgrees);
      verdict = agreeing.length === 1 ? "STRONG" : "AMBIGUOUS";
    }

    const inv = invByProj.get(p.id);
    const exp = expByProj.get(p.id);
    return {
      financeProjectId: p.id,
      financeProjectName: p.name,
      client: p.client,
      invoiceCount: inv?.count ?? 0,
      expenseCount: exp?.count ?? 0,
      cashflowCount: cfByProj.get(p.id) ?? 0,
      revenue: inv?.sum ?? 0,
      cost: exp?.sum ?? 0,
      verdict,
      candidates: cands,
    };
  });

  const tally = proposals.reduce<Record<Verdict, number>>(
    (a, p) => ((a[p.verdict] += 1), a),
    { STRONG: 0, MATCH: 0, AMBIGUOUS: 0, UNMATCHED: 0 },
  );

  // ── Render markdown report ──
  const won = (n: number) => `₩${n.toLocaleString("ko-KR")}`;
  const lines: string[] = [];
  lines.push("# CFO ↔ Deal Reconciliation (DRY-RUN, ADR-001 Phase 1)");
  lines.push("");
  lines.push(`- FinanceProjects: **${projects.length}**  ·  Engagements: **${engRefs.length}**`);
  lines.push(
    `- STRONG **${tally.STRONG}**  ·  MATCH **${tally.MATCH}**  ·  AMBIGUOUS **${tally.AMBIGUOUS}**  ·  UNMATCHED **${tally.UNMATCHED}**`,
  );
  lines.push("");
  lines.push("| 재무프로젝트 | 거래처 | 매출 | 비용 | 건수(청구/비용/현금) | 판정 | 후보 Engagement |");
  lines.push("|---|---|--:|--:|:--:|:--:|---|");
  for (const p of proposals) {
    const cands = p.candidates.map((c) => `${c.name}${c.clientAgrees ? " ✓client" : ""}`).join("<br>") || "—";
    lines.push(
      `| ${p.financeProjectName} | ${p.client ?? "—"} | ${won(p.revenue)} | ${won(p.cost)} | ` +
        `${p.invoiceCount}/${p.expenseCount}/${p.cashflowCount} | ${p.verdict} | ${cands} |`,
    );
  }
  lines.push("");
  lines.push("> READ-ONLY. No database rows were modified. Review, then run the backfill (Phase 2).");

  const here = dirname(fileURLToPath(import.meta.url));
  const outDir = join(here, "..", ".cfo-backup");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "cfo-deal-reconcile.md"), lines.join("\n"), "utf8");
  writeFileSync(join(outDir, "cfo-deal-reconcile.json"), JSON.stringify({ tally, proposals }, null, 2), "utf8");

  console.log(`\nFinanceProjects: ${projects.length} · Engagements: ${engRefs.length}`);
  console.log(`STRONG ${tally.STRONG} · MATCH ${tally.MATCH} · AMBIGUOUS ${tally.AMBIGUOUS} · UNMATCHED ${tally.UNMATCHED}`);
  console.log(`→ report: packages/db/.cfo-backup/cfo-deal-reconcile.md (gitignored)\n`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

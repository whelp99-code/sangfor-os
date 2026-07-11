/**
 * 재검증 데일리 배치 — mail_derived_candidates를 재검증해 신뢰도/결정을 갱신한다.
 * 763cd95 자가치유 캐시 덕분에 force 없이도 이전 실행에서 LLM-outage로
 * fallback(mode=template + fallbackReason)된 건은 자동 재시도된다.
 *
 * 실행: npx tsx packages/business/scripts/revalidate-batch.ts --status proposed --concurrency 2 --max 200
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, appendFileSync } from "node:fs";
import { prisma } from "@sangfor/db";
import { revalidateMailDerivedCandidate } from "../src/mail/classify-ai";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");

function parseArgs(argv: string[]) {
  const get = (flag: string, def: string) => {
    const idx = argv.indexOf(flag);
    return idx !== -1 && argv[idx + 1] ? argv[idx + 1] : def;
  };
  return {
    status: get("--status", "proposed"),
    concurrency: Math.max(1, Number(get("--concurrency", "2"))),
    max: Math.max(1, Number(get("--max", "200"))),
  };
}

async function main() {
  const { status, concurrency, max } = parseArgs(process.argv.slice(2));
  const runStart = new Date();

  const candidates = await prisma.mailDerivedCandidate.findMany({
    where: { status },
    orderBy: { updatedAt: "asc" },
    take: max,
    select: { id: true, candidateType: true, title: true },
  });

  const logDir = path.resolve(REPO_ROOT, ".agents/results/kpi");
  mkdirSync(logDir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const logPath = path.join(logDir, `revalidate-${stamp}.log`);

  console.log(`status=${status} concurrency=${concurrency} max=${max} candidates=${candidates.length}`);

  let processed = 0;
  let llmOk = 0;
  let fallback = 0;
  let cached = 0;
  let rejected = 0;
  let errors = 0;
  let idx = 0;

  const workers = Array.from({ length: concurrency }, async () => {
    while (idx < candidates.length) {
      const c = candidates[idx++];
      try {
        const res = await revalidateMailDerivedCandidate(c.id);
        const reval = (
          res as { revalidation?: { decision?: string; mode?: string; fallbackReason?: string; revalidatedAt?: string } }
        ).revalidation ?? null;
        const revalidatedAt = reval?.revalidatedAt ? new Date(reval.revalidatedAt) : null;
        const isFreshThisRun = revalidatedAt != null && revalidatedAt.getTime() >= runStart.getTime();
        const isTrueFallback = reval?.mode === "template" && typeof reval.fallbackReason === "string";
        const outcome = !reval ? "unknown" : !isFreshThisRun ? "cached" : isTrueFallback ? "fallback" : "llm_ok";
        if (outcome === "cached") cached += 1;
        else if (outcome === "fallback") fallback += 1;
        else if (outcome === "llm_ok") llmOk += 1;
        if (reval?.decision === "reject") rejected += 1;
        processed += 1;
        appendFileSync(
          logPath,
          `${JSON.stringify({ id: c.id, type: c.candidateType, title: c.title, decision: reval?.decision ?? null, outcome })}\n`,
        );
      } catch (error) {
        errors += 1;
        appendFileSync(
          logPath,
          `${JSON.stringify({ id: c.id, type: c.candidateType, title: c.title, error: String(error).slice(0, 200) })}\n`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  });
  await Promise.all(workers);

  // Rate is over freshly-revalidated items only (llmOk + fallback) — cached
  // results carry no signal about current LLM provider health and would
  // dilute/inflate the rate depending on how much of the batch was cache hits.
  const freshTotal = llmOk + fallback;
  const fallbackRate = freshTotal > 0 ? Math.round((fallback / freshTotal) * 100) : 0;
  console.log(
    `processed=${processed} llmOk=${llmOk} fallback=${fallback} (${fallbackRate}% of ${freshTotal} freshly-revalidated) cached=${cached} rejected=${rejected} errors=${errors}`,
  );
  if (fallbackRate > 30) {
    console.warn(`WARNING: fallback rate ${fallbackRate}% exceeds 30% threshold — check LLM provider health`);
  }
  console.log(`log: ${logPath}`);

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

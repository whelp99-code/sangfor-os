/**
 * 남은 다듬기 실증 — 실 DB 로 게이팅/대시보드/임베더 경로를 확인.
 * 실행: npx tsx packages/business/scripts/verify-polish.ts
 */
import { prisma } from "@sangfor/db";
import { loadModelPolicyFromDb, buildGatedModelMap, DOMAIN_DATA_CLASS } from "../src/domain-model-policy";
import { buildDomainDashboardSnapshot, createPrismaDomainStatsLoader } from "../src/domain-dashboard";
import { describeEmbedder } from "../src/domain-embedder-openai";

async function main() {
  console.log("=== ② AiModel 레지스트리 게이팅 (실 DB) ===");
  const registry = await loadModelPolicyFromDb(prisma as never);
  console.log("registry:", registry.map((r) => `${r.modelID}[${r.allowedDataClassification.join(",")}]`).join("  "));
  const map = buildGatedModelMap({ registry });
  for (const [d, m] of Object.entries(map)) {
    console.log(`  ${d.padEnd(10)} (${DOMAIN_DATA_CLASS[d as keyof typeof DOMAIN_DATA_CLASS]}) → ${m?.modelID}`);
  }

  console.log("\n=== ④ 대시보드 데이터 경로 (실 DB) ===");
  const snap = await buildDomainDashboardSnapshot(createPrismaDomainStatsLoader(prisma as never));
  console.log("totals:", snap.totals);
  for (const r of snap.rows) {
    console.log(`  ${r.label.padEnd(14)} | 메모리 ${r.memoryCount} · 결정 ${r.decisionCount} · 최근 ${r.lastOutcome ?? "-"} → ${r.handoffTo ?? "완료"}`);
  }

  console.log(`\n=== ③ 활성 임베더: ${describeEmbedder()} (키 없으면 hash 폴백) ===`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("VERIFY ERROR:", e);
  process.exit(1);
});

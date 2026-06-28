/**
 * 실증(e2e) — 실제 opencode(format)로 CFO 도메인 구조화 산출물을 받는다.
 * 실행: npx tsx packages/business/scripts/domain-structured-e2e.ts
 */
import { createOpencodeStructuredGenerator } from "../src/domain-structured";
import { opencodeHealth } from "../src/opencode-client";

async function main() {
  if (!(await opencodeHealth())) {
    console.error("opencode 서버 미응답. `opencode serve --port 4096` 먼저 실행.");
    process.exit(2);
  }
  const gen = createOpencodeStructuredGenerator({
    models: { cfo: { providerID: "openai", modelID: "gpt-5.4" } },
    system: "Sangfor B2B 영업 파이프라인 CFO. 한국어. 스키마에 맞는 JSON만 산출.",
  });
  const artifact = await gen({
    domain: "cfo",
    case: { id: "se2e", subject: "NGAF 교체 상업 승인 검토", tags: ["firewall", "enterprise"] },
    recalled: [],
    prompt:
      "제조 대기업 본사+3개 공장 NGAF 교체 건. 예상 견적 5천만원, 할인 10%. 마진/캐시플로우 관점에서 상업 승인 결정을 내려라.",
  });
  console.log("\n=== 구조화 산출물 (typed) ===");
  console.log("summary:", artifact.summary);
  console.log("structured:", JSON.stringify((artifact.payload as { structured?: unknown }).structured, null, 2));
}

main().catch((e) => {
  console.error("STRUCTURED E2E ERROR:", e);
  process.exit(1);
});

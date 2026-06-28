/**
 * 실증(e2e) — 실제 opencode 서버(+OpenAI ChatGPT OAuth)로 도메인 파이프라인을 돌린다.
 * 전제: `opencode serve` 가 127.0.0.1:4096 에서 실행 중, OpenAI OAuth 인증됨.
 *
 * 실행: npx tsx packages/business/scripts/domain-llm-e2e.ts
 */
import { prisma } from "@sangfor/db";
import { runDomainPipeline, type DomainCase } from "../src/domain-agent-runtime";
import { createOpencodeDomainGenerator } from "../src/domain-llm";
import { opencodeHealth } from "../src/opencode-client";

const SLUG = "demo-project";

async function main() {
  if (!(await opencodeHealth())) {
    console.error("opencode 서버가 127.0.0.1:4096 에서 응답하지 않습니다. `opencode serve` 를 먼저 실행하세요.");
    process.exit(2);
  }

  // 도메인별 모델 라우팅 (적합성 기준): 경량 도메인은 mini-fast, 민감/추론은 강한 모델
  const generate = createOpencodeDomainGenerator({
    system: "너는 Sangfor B2B 영업 파이프라인의 도메인 전문가다. 한국어로 3문장 이내로 핵심만 답하라.",
    models: {
      marketing: { providerID: "openai", modelID: "gpt-5.4-mini-fast" },
      sales: { providerID: "openai", modelID: "gpt-5.4-mini-fast" },
      presales: { providerID: "openai", modelID: "gpt-5.4-fast" },
      engineer: { providerID: "openai", modelID: "gpt-5.4-fast" },
      cfo: { providerID: "openai", modelID: "gpt-5.4" },
    },
  });

  const inbound: DomainCase = {
    id: "e2e-case-1",
    subject: "Sangfor 차세대 방화벽(NGAF) 도입 문의 — 제조 대기업, 본사+3개 공장",
    tags: ["firewall", "ngaf", "security", "enterprise"],
    content: "기존 타사 방화벽 노후화로 교체 검토 중. 다지점 통합관리/HA 필요. 예산·납기 협의 희망.",
  };

  console.log(`\n${"=".repeat(74)}\n실제 LLM(opencode+OpenAI OAuth) end-to-end · 인입: "${inbound.subject}"\n${"=".repeat(74)}`);

  const results = await runDomainPipeline(inbound, { generate, projectSlug: SLUG });

  for (const r of results) {
    const model = (r.artifact.payload as { model?: { modelID?: string } } | undefined)?.model?.modelID ?? "?";
    console.log(`\n[${r.domain}] model=${model} | 렌즈 [${r.requiredLenses.join(",")}] | gate ${r.gatePass ? "PASS" : "FAIL"} → ${r.handoffTo ?? "(완료)"}`);
    console.log(`  └ 산출물(${r.artifact.produces}): ${r.artifact.summary.replace(/\s+/g, " ").slice(0, 240)}`);
  }

  console.log(`\n${"=".repeat(74)}\n완료: ${results.length}개 도메인이 실제 LLM 으로 산출물 생성 + 컬러게이트 + 핸드오프.\n${"=".repeat(74)}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("E2E ERROR:", e);
  process.exit(1);
});

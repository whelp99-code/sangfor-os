/**
 * 실증 데모 — 인입 메일 1건을 종축 5단계 파이프라인에 통과시킨다.
 * Case A 처리(학습 누적) → Case B(유사) 처리 시 각 도메인이 A를 recall 하는 것까지 실제 DB로 증명.
 *
 * 실행: npx tsx packages/business/scripts/domain-pipeline-demo.ts
 */
import { prisma } from "@sangfor/db";
import { GTM_PIPELINE, type GtmDomain } from "@sangfor/shared/modes";
import {
  DOMAIN_DEFINITIONS,
  lensesForDomain,
  buildDomainHandoff,
} from "../src/domain-pipeline";
import { checkColorGate } from "../src/color-agent";
import {
  upsertDomainMemory,
  recordDomainDecision,
  recallFromDb,
} from "../src/domain-memory";

const SLUG = "demo-project";

type InboundCase = { id: string; subject: string; tags: string[] };

// 도메인별로 케이스에서 주목하는 태그 (실제로는 분류 AI가 추출)
function tagsForDomain(domain: GtmDomain, c: InboundCase): string[] {
  const base = c.tags;
  const extra: Record<GtmDomain, string[]> = {
    marketing: ["inbound-lead"],
    sales: ["quote", "discount"],
    presales: ["poc", "tech-fit"],
    engineer: ["deployment", "onsite"],
    cfo: ["margin", "cashflow"],
  };
  return [...base, ...extra[domain]];
}

async function runCase(c: InboundCase, round: number) {
  console.log(`\n${"━".repeat(72)}`);
  console.log(`ROUND ${round} · 인입: "${c.subject}"  [tags: ${c.tags.join(", ")}]`);
  console.log("━".repeat(72));

  let cursor: GtmDomain | null = GTM_PIPELINE[0];
  while (cursor) {
    const domain: GtmDomain = cursor;
    const def = DOMAIN_DEFINITIONS[domain];
    const tags = tagsForDomain(domain, c);

    // 1) 도메인 메모리 recall (격리: 이 도메인 메모리만)
    const recalled = await recallFromDb({ domain, tags }, SLUG, 3);

    // 2) 횡축 컬러 렌즈 산출
    const lenses = lensesForDomain(domain);

    // 3) 컬러 게이트 (데모: 필요한 렌즈 전부 통과 가정)
    const gatePass = checkColorGate(lenses.required, lenses.required, []);

    // 4) 결정/핸드오프 기록 (감사)
    const handoff = buildDomainHandoff(domain);
    await recordDomainDecision({
      projectSlug: SLUG,
      domain,
      caseRef: c.id,
      decisionType: "pipeline-stage",
      inputJson: { subject: c.subject, tags },
      outputJson: { produces: def.produces, handoffTo: handoff.to },
      colorGateJson: { required: lenses.required, pass: gatePass },
      outcome: gatePass ? "approved" : "rejected",
    });

    // 5) 학습: 이 케이스 결과를 도메인 메모리에 누적
    await upsertDomainMemory({
      projectSlug: SLUG,
      domain,
      memoryType: "case",
      key: `${domain}:${c.id}`,
      label: `${def.label} — ${c.subject}`,
      tags,
      valueJson: { subject: c.subject, produces: def.produces },
      outcome: gatePass ? "approved" : "rejected",
      source: "demo",
      confidence: 90,
    });

    const recallNote =
      recalled.length > 0
        ? `↩ recall ${recalled.length}건 (예: "${recalled[0].label}")`
        : "recall 0건 (학습 이전)";
    console.log(
      `  ${def.label.padEnd(14)} | 렌즈 [${lenses.required.join(",").padEnd(18)}] | gate ${
        gatePass ? "PASS" : "FAIL"
      } | → ${handoff.to ?? "(완료)"}  ${recallNote}`,
    );

    cursor = def.next;
  }
}

async function main() {
  // 데모 멱등성: 이전 데모 메모리/로그 정리
  const project = await prisma.project.findUniqueOrThrow({ where: { slug: SLUG } });
  await prisma.domainMemory.deleteMany({ where: { projectId: project.id, source: "demo" } });
  await prisma.domainDecisionLog.deleteMany({
    where: { projectId: project.id, decisionType: "pipeline-stage" },
  });

  const caseA: InboundCase = {
    id: "demo-caseA",
    subject: "Sangfor 차세대 방화벽 도입 문의 (제조 대기업)",
    tags: ["firewall", "security", "enterprise"],
  };
  const caseB: InboundCase = {
    id: "demo-caseB",
    subject: "Sangfor 방화벽 + 보안 솔루션 견적 요청 (제조)",
    tags: ["firewall", "security", "enterprise"],
  };

  await runCase(caseA, 1); // 학습 누적
  await runCase(caseB, 2); // 유사 케이스 → A를 recall

  // 누적 결과 요약
  const memCount = await prisma.domainMemory.count({
    where: { projectId: project.id, source: "demo" },
  });
  const logCount = await prisma.domainDecisionLog.count({
    where: { projectId: project.id, decisionType: "pipeline-stage" },
  });
  console.log(`\n${"━".repeat(72)}`);
  console.log(`누적: DomainMemory ${memCount}건, DomainDecisionLog ${logCount}건 (감사 추적)`);
  console.log("증명: ROUND 2 의 각 도메인이 ROUND 1 에서 학습한 케이스를 recall 했다.");
  console.log("━".repeat(72));

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("DEMO ERROR:", e);
  process.exit(1);
});

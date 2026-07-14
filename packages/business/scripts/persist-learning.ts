/**
 * 추출된 업무 패턴을 학습 스파인에 영속화한다.
 *
 * - DomainMemory(case): 대화 1건 = 처리 사례 1건. recall이 다음 유사 상황에 꺼내 쓴다.
 * - DomainMemory(rule): 업무 유형별 재사용 규칙. 같은 유형의 처리 방식을 일반화한다.
 * - PolicyMemory: 도메인 → 역할(고객/파트너/총판). 분류기가 발신자를 바로 해석하게 한다.
 *
 * Usage: tsx packages/business/scripts/persist-learning.ts [--apply]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { prisma } from "@sangfor/db";

import { upsertDomainMemory } from "../src/domain-ai/domain-memory";
import { upsertPolicyMemory } from "../src/mail/mail-policy-memory";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const EXTRACTIONS = path.join(REPO_ROOT, ".agents/results/learning/extractions.json");
const APPLY = process.argv.includes("--apply");

interface Extraction {
  file: string;
  workType?: string;
  summary?: string;
  directCounterparty?: { name?: string; domain?: string; role?: string } | null;
  endCustomer?: { name?: string; evidence?: string } | null;
  contacts?: Array<{ name?: string; title?: string; company?: string }>;
  products?: string[];
  amounts?: string[];
  deadlines?: string[];
  competitors?: string[];
  myActions?: string[];
  escalation?: string | null;
  outcome?: string;
  outcomeEvidence?: string | null;
  resolutionPattern?: string | null;
  patternEvidence?: string | null;
  signals?: string[];
}

// 업무 유형 → GTM 도메인. recall은 도메인 단위로 조회하므로 잘못 매핑하면 안 꺼내진다.
const DOMAIN_OF: Record<string, string> = {
  견적요청: "sales",
  라이선스갱신: "sales",
  발주계약: "sales",
  파트너등록: "partner",
  기술지원: "presales",
  정보요청: "presales",
  정산청구: "finance",
};

const ROLE_TO_POLICY: Record<string, string> = {
  고객: "known_customer_name",
  파트너: "known_partner_name",
  총판: "known_partner_name",
};

// 상대가 수령·해결을 회신으로 확인한 건만 "확인완료"다. 내가 답장만 보낸 건(응답완료)을
// 성공 사례로 학습시키면 AI가 "보내면 끝"으로 오학습해 팔로업을 빠뜨린다.
const CONFIRMED = "확인완료";

async function main() {
  const items: Extraction[] = JSON.parse(fs.readFileSync(EXTRACTIONS, "utf8"));
  console.log(`추출 ${items.length}건 로드${APPLY ? "" : " (dry-run — --apply로 저장)"}`);

  const byType = new Map<string, Extraction[]>();
  const domainRoles = new Map<string, Map<string, number>>();

  for (const item of items) {
    const type = item.workType ?? "기타";
    if (!byType.has(type)) byType.set(type, []);
    byType.get(type)!.push(item);

    const cp = item.directCounterparty;
    const domain = cp?.domain?.trim().toLowerCase();
    const role = cp?.role?.trim();
    if (domain && role && ROLE_TO_POLICY[role]) {
      if (!domainRoles.has(domain)) domainRoles.set(domain, new Map());
      const roles = domainRoles.get(domain)!;
      roles.set(role, (roles.get(role) ?? 0) + 1);
    }
  }

  let cases = 0;
  let rules = 0;
  let policies = 0;

  for (const [type, group] of byType) {
    const domain = DOMAIN_OF[type] ?? "sales";

    for (const item of group) {
      if (!item.summary) continue;
      cases++;
      if (!APPLY) continue;
      await upsertDomainMemory({
        domain,
        memoryType: "case",
        key: `mail-history:${item.file}`,
        label: item.summary.slice(0, 200),
        tags: [
          `domain:${domain}`,
          `worktype:${type}`,
          `outcome:${item.outcome ?? "불명"}`,
          ...(item.signals ?? []).slice(0, 4).map((s) => `signal:${s.slice(0, 40)}`),
        ],
        valueJson: {
          source: "mail-history-replay",
          workType: type,
          summary: item.summary,
          directCounterparty: item.directCounterparty ?? null,
          endCustomer: item.endCustomer ?? null,
          contacts: item.contacts ?? [],
          products: item.products ?? [],
          amounts: item.amounts ?? [],
          deadlines: item.deadlines ?? [],
          competitors: item.competitors ?? [],
          myActions: item.myActions ?? [],
          escalation: item.escalation ?? null,
          resolutionPattern: item.patternEvidence ? item.resolutionPattern : null,
          outcomeEvidence: item.outcomeEvidence ?? null,
          transcript: item.file,
        },
        outcome: item.outcome === CONFIRMED ? "approved" : "proposed",
        source: "human",
        confidence: item.outcome === CONFIRMED ? 85 : 60,
      });
    }

    // 규칙은 원문 근거가 붙은 패턴에서만 뽑는다 — 근거 없는 resolutionPattern은 LLM이
    // 지어낸 것이다(검증에서 확인). 다만 "그가 그렇게 했다"와 "그게 통했다"는 다른 문제라,
    // 상대 확인율(confirmedRate)을 함께 남기고 신뢰도에 반영한다.
    const evidenced = group.filter((g) => g.resolutionPattern && g.patternEvidence);
    const confirmed = group.filter((g) => g.outcome === CONFIRMED);
    if (evidenced.length >= 2) {
      rules++;
      const confirmedRate = Math.round((confirmed.length / group.length) * 100);
      if (APPLY) {
        await upsertDomainMemory({
          domain,
          memoryType: "rule",
          key: `worktype-playbook:${type}`,
          label: `${type} 처리 규칙 (근거 있는 사례 ${evidenced.length}건에서 도출, 상대 확인 ${confirmedRate}%)`,
          tags: [`domain:${domain}`, `worktype:${type}`, "source:mail-history"],
          valueJson: {
            workType: type,
            totalCases: group.length,
            evidencedCases: evidenced.length,
            confirmedCases: confirmed.length,
            confirmedRate,
            patterns: [...new Set(evidenced.map((g) => g.resolutionPattern!))].slice(0, 12),
            commonActions: [...new Set(group.flatMap((g) => g.myActions ?? []))].slice(0, 12),
            commonEscalations: [
              ...new Set(group.map((g) => g.escalation).filter(Boolean) as string[]),
            ].slice(0, 8),
            typicalDeadlines: [...new Set(group.flatMap((g) => g.deadlines ?? []))].slice(0, 8),
          },
          outcome: "approved",
          source: "human",
          confidence: Math.min(90, 45 + evidenced.length * 2),
        });
      }
    }
  }

  for (const [domain, roles] of domainRoles) {
    const [role, count] = [...roles].sort((a, b) => b[1] - a[1])[0];
    // 한 번만 등장한 도메인은 오분류일 수 있다. 근거가 2건 이상일 때만 정책으로 굳힌다.
    if (count < 2) continue;
    policies++;
    if (!APPLY) continue;
    await upsertPolicyMemory({
      memoryType: ROLE_TO_POLICY[role],
      key: domain,
      label: `${domain} → ${role} (메일 이력 ${count}건 근거)`,
      valueJson: { source: "mail-history-replay", role, evidenceCount: count },
      status: "approved",
      confidence: Math.min(95, 60 + count * 5),
    });
  }

  console.log(`\n사례(case) ${cases} · 유형규칙(rule) ${rules} · 도메인정책 ${policies}`);
  if (APPLY) {
    const [dm, pm] = await Promise.all([
      prisma.domainMemory.count(),
      prisma.policyMemory.count(),
    ]);
    console.log(`저장 후 — DomainMemory ${dm} · PolicyMemory ${pm}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

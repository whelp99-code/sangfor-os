import type { DomainKey } from './artifact-domain-map';
import {
  getOpenAiApiKey,
  getOpenAiChatCompletionsUrl,
  getOpenAiAuthHeaders,
  getOpenAiModel,
  buildChatCompletionRequestBody,
  extractChatCompletionText,
} from '../platform/openai-config';
import { withBackoff } from '../mail/ai-classify-batch';
import {
  recordDomainDecision,
  loadDomainMemories,
  recallDomainMemories,
  buildMemoryTags,
} from './domain-memory';
import { verifyProposalColorGate, type ColorGateVerdict } from './color-gate-llm';
import { Prisma, prisma } from '@sangfor/db';
import { sanitizeJsonStrings } from '@sangfor/shared';

export interface GenerateProposalInput {
  engagementId: string;
  domain: DomainKey;
  engagementName: string;
  customerName?: string;
  contextNote?: string;
}

export interface DomainProposal {
  domain: DomainKey;
  title: string;
  bodyMarkdown: string;
  colorGate?: ColorGateVerdict;
  /** 생성 시도 수(1 = 초기, 2+ = 재작업 루프 발생). */
  attempts?: number;
  /** 최대 재작업 후에도 게이트 미통과 → 자동승격 금지, 사람 검토 필요. */
  escalated?: boolean;
}

const DOMAIN_INTENT: Record<DomainKey, string> = {
  presales: '제안서 개요',
  cfo: '정산/손익 요약',
  sales: '견적 전략',
  engineer: '납품 체크리스트',
  marketing: '리드 메모',
};

// 도메인별 고정 섹션 템플릿 — 문서 형태 일관화(딥리서치 근거,
// docs/research/2026-07-04-b2b-document-standards.md). LLM이 매번 구조를 즉흥
// 생성해 헤딩 레벨·섹션 수가 문서마다 달라지던 문제를 고정 스켈레톤으로 해소.
const DOMAIN_DOC_TEMPLATE: Record<DomainKey, string> = {
  presales: `[문서 유형: 기술/영업 제안서] 아래 9개 섹션을 이 순서·번호로 반드시 포함(최상위 헤딩은 "# ", 하위는 "## "/"### " — 레벨 혼용 금지):
# 1. 요약 — 고객 과제·해결책·기대 성과·투자 범위를 한 문단으로(제품 기능 나열 금지, 이 섹션만 읽어도 통하게)
# 2. 문제 정의 및 배경 — 고객 페인을 고객의 언어로
# 3. 목표 및 성공기준 — 측정 가능한 지표(현재값→목표값)
# 4. 제안 솔루션 및 아키텍처 — 요구사항↔솔루션 직접 매핑
# 5. 제안 범위 — 산출물 / 고객 책임 / 제외항목 3가지를 명시
# 6. 구축 계획 및 일정 — 단계·마일스톤
# 7. 가격 및 투자 구조
# 8. 성공 지표 및 기대효과 — 정량 성과
# 9. 다음 단계 및 의사결정 일정
※ 단, 메일이 PoC/호환성 검증/파일럿 건이면 [PoC 계획서]로 대체: # 1. 문제정의+유스케이스 # 2. 범위(포함/제외) # 3. 성공기준+스코어링 모델 # 4. 측정지표(기준값→목표값) # 5. 일정 # 6. 역할·리소스 # 7. 종료·전환 조건.`,
  sales: `[문서 유형: 견적서] 아래 항목을 이 순서·번호로 포함(최상위 헤딩 "# ", 하위 "## "):
# 1. 공급자·고객 정보 — 사업자번호 포함
# 2. 품목 명세 — 품명 / 규격 / 단가 / 수량 / 금액(표 형태)
# 3. 금액 — 공급가액 / 부가세(10%) / 합계
# 4. 유효기간 — "본 견적은 [날짜]까지 유효" 명시
# 5. 결제 조건
# 6. 약관
# 7. 수락란
※ 마진은 마크업≠마진 구분(총판가↔판매가), 베를로 룰(총판가+파트너 10%/고객 40%) 준수.`,
  engineer: `[문서 유형: 구축/기술지원 보고서] 유형에 맞는 섹션을 이 순서·번호로(최상위 헤딩 "# "):
· 구축완료: # 1. 프로젝트 식별 # 2. 목표 # 3. 산출물 + 수령자 # 4. 마일스톤 완료 상태 # 5. 인수기준 # 6. 인수(승인자 이름·직함·날짜·서명)
· 장애/지원: # 1. 인시던트 기록 # 2. 영향 # 3. 완화·해결 조치 # 4. 근본원인 # 5. 재발방지 액션
※ SLA/임계 기준 명시, 근본원인은 충분히 깊게.`,
  cfo: `[문서 유형: 재무 정산] 아래 흐름을 이 순서·번호로(최상위 헤딩 "# "):
# 1. 거래처·기간
# 2. 매입 내역 — 총판/벤더發
# 3. 매출 내역 — 고객/파트너向
# 4. 마진(손익) = 매출 − 매입, 마진율(리뉴얼 20% 룰 교차 확인)
# 5. 세금계산서 발행/수취 대조
# 6. 입금·미수 대사
※ 매입 ≤ 매출 정합, 숫자는 등폭 정렬.`,
  marketing: `[문서 유형: 리드/캠페인 브리프] 아래 순서·번호로(최상위 헤딩 "# "):
# 1. 요약 # 2. 타겟·세그먼트 # 3. 가치 제안 # 4. 채널·실행안 # 5. 기대 지표(MQL) # 6. 다음 단계.`,
};

// 전 문서 공통 가독성·설득력 규칙(딥리서치 근거).
const WRITING_RULES = `[가독성] 문장은 15~20단어 이내, 문단은 6줄 이내. 헤딩 레벨(#/##/###)을 일관되게 사용한다.
[설득력] 의사결정자의 3가지 평가(①문제를 이해했나 ②실패 확률을 낮추나 ③비용·일정·리스크가 수용 가능한가)를 정조준한다. 가치는 기능이 아니라 정량 성과로, 고객이 쓴 표현을 그대로 쓴다. 리스크는 숨기지 말고 상위 항목을 대응책과 함께 공개한다. 컨텍스트에 없는 수치·사실을 지어내지 말고, 모르는 값은 "확인 필요"로 표기한다.`;

export function buildDomainPrompt(
  input: GenerateProposalInput,
  recalledMemories: string[],
): { system: string; user: string } {
  const intent = DOMAIN_INTENT[input.domain];
  const template = DOMAIN_DOC_TEMPLATE[input.domain];

  const memoriesSection =
    recalledMemories.length > 0
      ? `\n\n과거 사람이 확정한 방식:\n${recalledMemories.map((m, i) => `${i + 1}. ${m}`).join('\n')}`
      : '';

  const system = `당신은 한국 B2B 업무자동화 OS의 AI 어시스턴트입니다.
도메인: ${input.domain} — ${intent}
${WRITING_RULES}
반드시 아래 json 형식으로만 응답하세요:
{ "title": "...", "bodyMarkdown": "..." }
다른 텍스트는 절대 포함하지 마세요.${memoriesSection}`;

  const customerPart = input.customerName ? `\n고객사: ${input.customerName}` : '';
  const contextPart = input.contextNote ? `\n추가 컨텍스트: ${input.contextNote}` : '';

  const user = `딜(engagement): ${input.engagementName}${customerPart}${contextPart}

${template}

위 딜에 대한 문서를 위 섹션 템플릿을 그대로 지켜 작성하세요.
json 형식으로 title과 bodyMarkdown(마크다운 본문)을 반환하세요.`;

  return { system, user };
}

export async function generateDomainProposal(
  input: GenerateProposalInput,
  deps?: {
    callLLM?: (system: string, user: string) => Promise<string>;
    /** injectable for tests; default: looks up via engagement→opportunity→project */
    getProjectSlug?: (engagementId: string) => Promise<string | undefined>;
  },
): Promise<DomainProposal> {
  // 1. Load memories from DB
  const memories = await loadDomainMemories(input.domain);

  // 2. Recall/filter top relevant memories.
  // Query tags MUST use the same buildMemoryTags vocabulary the write path
  // stores (project-decision.ts writes domain:/entity:/intent: tags); passing
  // raw [domain, engagementName] never overlapped, so approved proposal
  // memories were unrecallable (Step 8 / ADR-001 D5).
  const recalled = recallDomainMemories(
    { domain: input.domain, tags: buildMemoryTags({ domain: input.domain, entityType: "proposal" }) },
    memories,
  );

  // 3. Map to string array for prompt
  const recalledStrings = recalled.map((r) => r.label);

  // 4. Build prompt with memories
  const { system, user } = buildDomainPrompt(input, recalledStrings);

  // LLM caller (injectable for tests; default = 9router fetch).
  const callLLM = async (sys: string, usr: string): Promise<string> => {
    if (deps?.callLLM) return deps.callLLM(sys, usr);
    const key = getOpenAiApiKey();
    if (!key) throw new Error('no LLM key');
    const res = await withBackoff(() =>
      fetch(getOpenAiChatCompletionsUrl(), {
        method: 'POST',
        headers: getOpenAiAuthHeaders(key),
        body: JSON.stringify(
          buildChatCompletionRequestBody({
            model: getOpenAiModel(),
            jsonMode: true,
            maxCompletionTokens: 4000,
            messages: [
              { role: 'system', content: sys },
              { role: 'user', content: usr },
            ],
          }),
        ),
      }).then((r) => {
        if (!r.ok) throw new Error('llm_' + r.status);
        return r.json() as Promise<Parameters<typeof extractChatCompletionText>[0]>;
      }),
    );
    const text = extractChatCompletionText(res);
    if (!text) throw new Error('llm_empty_response');
    return text;
  };

  const parseProposal = (rawText: string): { title: string; bodyMarkdown: string } => {
    const stripped = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
    let parsed: { title?: string; bodyMarkdown?: string };
    try {
      parsed = JSON.parse(stripped) as { title?: string; bodyMarkdown?: string };
    } catch {
      throw new Error('llm_parse_error: ' + rawText.slice(0, 100));
    }
    return { title: parsed.title ?? '', bodyMarkdown: parsed.bodyMarkdown ?? '' };
  };

  const runGate = async (
    title: string,
    bodyMarkdown: string,
  ): Promise<ColorGateVerdict | undefined> => {
    if (!title || !bodyMarkdown) return undefined;
    try {
      return await verifyProposalColorGate({
        domain: input.domain,
        title,
        bodyMarkdown,
        customerName: input.customerName,
        contextNote: input.contextNote,
      });
    } catch {
      return undefined; // 게이트 호출 실패 시 검증 없이 진행
    }
  };

  // 5. Initial generation + color gate.
  let { title, bodyMarkdown } = parseProposal(await callLLM(system, user));
  let colorGate = await runGate(title, bodyMarkdown);
  let attempts = 1;

  // 6. Self-refine loop: 게이트 fail이면 렌즈별 지적을 근거로 재작성 → 재검증(최대 N회).
  //    환각(게이트 gaming) 방지를 위해 "컨텍스트에 없는 값은 지어내지 말고 확인 필요로" 지시.
  const maxRevisions = Number(process.env.PROPOSAL_MAX_REVISIONS) || 2;
  const lensKeys = ['blue', 'red', 'orange', 'gray', 'teal'] as const;
  while (colorGate && !colorGate.pass && attempts <= maxRevisions) {
    const gate = colorGate;
    const failing = lensKeys
      .filter((k) => !gate.lenses[k].pass)
      .map((k) => `- ${k}: ${gate.lenses[k].note}`)
      .join('\n');
    const reviseUser = `아래 제안서가 컬러게이트 5렌즈 검증에서 다음 지적을 받았습니다:
${failing}

같은 섹션 템플릿과 헤딩 규칙을 유지하되, 각 지적을 아래 컨텍스트의 실제 근거로 보완해 다시 작성하세요.
컨텍스트에 없는 수치·사실은 지어내지 말고 "확인 필요"로 남기세요.

[컨텍스트]
딜: ${input.engagementName}${input.customerName ? ' / 고객사: ' + input.customerName : ''}
${input.contextNote ?? ''}

[현재 제안서]
${bodyMarkdown}

json 형식으로 title과 bodyMarkdown(개선된 마크다운 본문)만 반환하세요.`;
    ({ title, bodyMarkdown } = parseProposal(await callLLM(system, reviseUser)));
    colorGate = await runGate(title, bodyMarkdown);
    attempts++;
  }

  // 최대 재작업 후에도 미통과면 escalated(자동승격 금지 신호).
  const escalated = colorGate ? !colorGate.pass : false;

  // 7. Look up projectSlug via engagement → opportunity → project chain
  let projectSlug: string | undefined;
  if (deps?.getProjectSlug) {
    projectSlug = await deps.getProjectSlug(input.engagementId);
  } else {
    const eng = await prisma.engagement.findUnique({
      where: { id: input.engagementId },
      select: { opportunity: { select: { projectId: true } } },
    });
    const projectId = eng?.opportunity?.projectId ?? null;
    const projectRow = projectId
      ? await prisma.project.findUnique({ where: { id: projectId }, select: { slug: true } })
      : null;
    projectSlug = projectRow?.slug ?? undefined;
  }

  // 8. Sanitize + persist (게이트 판정 + attempts/escalated 포함).
  const sanitized = sanitizeJsonStrings({ title, bodyMarkdown }) as Prisma.InputJsonValue;
  const gateForLog = colorGate ? { ...colorGate, attempts, escalated } : undefined;
  await recordDomainDecision({
    projectSlug,
    domain: input.domain,
    caseRef: 'eng:' + input.engagementId,
    decisionType: 'ai_proposal',
    outputJson: sanitized,
    colorGateJson: gateForLog
      ? (sanitizeJsonStrings(gateForLog) as Prisma.InputJsonValue)
      : undefined,
  });

  // 9. Return proposal
  return { domain: input.domain, title, bodyMarkdown, colorGate, attempts, escalated };
}

export async function getPendingProposals(
  engagementId: string,
): Promise<Array<{ id: string; domain: string; title: string; bodyMarkdown: string; createdAt: Date; colorGate?: ColorGateVerdict }>> {
  const rows = await prisma.domainDecisionLog.findMany({
    where: {
      caseRef: 'eng:' + engagementId,
      decisionType: 'ai_proposal',
      outcome: null,  // only truly pending (no human decision yet)
    },
    orderBy: { createdAt: 'asc' },
  });

  return rows.map((row) => {
    const out = row.outputJson as { title?: string; bodyMarkdown?: string };
    const gate = row.colorGateJson;
    return {
      id: row.id,
      domain: row.domain,
      title: out.title ?? '',
      bodyMarkdown: out.bodyMarkdown ?? '',
      createdAt: row.createdAt,
      colorGate:
        gate && typeof gate === 'object' && 'lenses' in (gate as object)
          ? (gate as unknown as ColorGateVerdict)
          : undefined,
    };
  });
}

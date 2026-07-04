import type { DomainKey } from '../artifact-domain-map';
import {
  getOpenAiApiKey,
  getOpenAiChatCompletionsUrl,
  getOpenAiAuthHeaders,
  getOpenAiModel,
  buildChatCompletionRequestBody,
  extractChatCompletionText,
} from '../openai-config';
import { withBackoff } from '../ai-classify-batch';
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
}

const DOMAIN_INTENT: Record<DomainKey, string> = {
  presales: '제안서 개요',
  cfo: '정산/손익 요약',
  sales: '견적 전략',
  engineer: '납품 체크리스트',
  marketing: '리드 메모',
};

export function buildDomainPrompt(
  input: GenerateProposalInput,
  recalledMemories: string[],
): { system: string; user: string } {
  const intent = DOMAIN_INTENT[input.domain];

  const memoriesSection =
    recalledMemories.length > 0
      ? `\n\n과거 사람이 확정한 방식:\n${recalledMemories.map((m, i) => `${i + 1}. ${m}`).join('\n')}`
      : '';

  const system = `당신은 한국 B2B 업무자동화 OS의 AI 어시스턴트입니다.
도메인: ${input.domain} — ${intent}
반드시 아래 json 형식으로만 응답하세요:
{ "title": "...", "bodyMarkdown": "..." }
다른 텍스트는 절대 포함하지 마세요.${memoriesSection}`;

  const customerPart = input.customerName ? `\n고객사: ${input.customerName}` : '';
  const contextPart = input.contextNote ? `\n추가 컨텍스트: ${input.contextNote}` : '';

  const user = `딜(engagement): ${input.engagementName}${customerPart}${contextPart}

위 딜에 대한 ${intent}를 작성해주세요.
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

  // 5. Call LLM
  let rawText: string;
  if (deps?.callLLM) {
    rawText = await deps.callLLM(system, user);
  } else {
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
            maxCompletionTokens: 1200,
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: user },
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
    rawText = text;
  }

  // 6. Parse JSON response — strip markdown code fences if present
  const stripped = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  let parsed: { title?: string; bodyMarkdown?: string };
  try {
    parsed = JSON.parse(stripped) as { title?: string; bodyMarkdown?: string };
  } catch {
    throw new Error('llm_parse_error: ' + rawText.slice(0, 100));
  }
  const title = parsed.title ?? '';
  const bodyMarkdown = parsed.bodyMarkdown ?? '';

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

  // 8. Color-gate LLM verification (review 모델). 비차단: 실패해도 생성은 유지.
  let colorGate: ColorGateVerdict | undefined;
  if (title && bodyMarkdown) {
    try {
      colorGate = await verifyProposalColorGate({
        domain: input.domain,
        title,
        bodyMarkdown,
        customerName: input.customerName,
        contextNote: input.contextNote,
      });
    } catch {
      // 검증 실패 시 게이트 없이 진행(사람이 그대로 검토)
    }
  }

  // 9. Sanitize before jsonb write
  const sanitized = sanitizeJsonStrings({ title, bodyMarkdown }) as Prisma.InputJsonValue;

  // 10. Persist DomainDecisionLog (컬러게이트 실판정 포함)
  await recordDomainDecision({
    projectSlug,
    domain: input.domain,
    caseRef: 'eng:' + input.engagementId,
    decisionType: 'ai_proposal',
    outputJson: sanitized,
    colorGateJson: colorGate
      ? (sanitizeJsonStrings(colorGate) as Prisma.InputJsonValue)
      : undefined,
  });

  // 11. Return proposal
  return { domain: input.domain, title, bodyMarkdown, colorGate };
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

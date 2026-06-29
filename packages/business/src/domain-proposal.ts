import type { DomainKey } from './artifact-domain-map';
import {
  getOpenAiApiKey,
  getOpenAiChatCompletionsUrl,
  getOpenAiAuthHeaders,
  getOpenAiModel,
  buildChatCompletionRequestBody,
  extractChatCompletionText,
} from './openai-config';
import { withBackoff } from './ai-classify-batch';
import {
  recordDomainDecision,
  loadDomainMemories,
  recallDomainMemories,
} from './domain-memory';
import { Prisma, prisma } from '@sangfor/db';

function sanitizeJsonStrings(value: unknown): unknown {
  if (typeof value === 'string') {
    return value
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
      .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, '')
      .replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '');
  }
  if (Array.isArray(value)) return value.map(sanitizeJsonStrings);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, sanitizeJsonStrings(v)]),
    );
  }
  return value;
}

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

  // 2. Recall/filter top relevant memories
  const recalled = recallDomainMemories(
    { domain: input.domain, tags: [input.domain, input.engagementName] },
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

  // 8. Sanitize before jsonb write
  const sanitized = sanitizeJsonStrings({ title, bodyMarkdown }) as Prisma.InputJsonValue;

  // 9. Persist DomainDecisionLog
  await recordDomainDecision({
    projectSlug,
    domain: input.domain,
    caseRef: 'eng:' + input.engagementId,
    decisionType: 'ai_proposal',
    outputJson: sanitized,
  });

  // 8. Return proposal
  return { domain: input.domain, title, bodyMarkdown };
}

export async function getPendingProposals(
  engagementId: string,
): Promise<Array<{ id: string; domain: string; title: string; bodyMarkdown: string; createdAt: Date }>> {
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
    return {
      id: row.id,
      domain: row.domain,
      title: out.title ?? '',
      bodyMarkdown: out.bodyMarkdown ?? '',
      createdAt: row.createdAt,
    };
  });
}

import { vi, describe, it, expect, afterAll, beforeAll } from 'vitest';
import { buildDomainPrompt, generateDomainProposal, getPendingProposals } from './domain-proposal';
import type { GenerateProposalInput } from './domain-proposal';

vi.mock('./domain-memory', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./domain-memory')>();
  return {
    ...actual,
    loadDomainMemories: vi.fn().mockResolvedValue([]),
    recordDomainDecision: vi.fn().mockResolvedValue({ id: 'mock-id' }),
  };
});

vi.mock('./color-gate-llm', () => ({
  verifyProposalColorGate: vi.fn().mockResolvedValue(undefined),
}));


describe('buildDomainPrompt', () => {
  it('presales — returns system/user with json and 제안서', () => {
    const input: GenerateProposalInput = {
      engagementId: 'e1',
      domain: 'presales',
      engagementName: '삼성전자 프로젝트',
      customerName: '삼성전자',
    };
    const result = buildDomainPrompt(input, []);
    expect(typeof result.system).toBe('string');
    expect(typeof result.user).toBe('string');
    expect(result.system.includes('json') || result.user.includes('json')).toBe(true);
    expect(result.user.includes('제안서') || result.system.includes('제안서')).toBe(true);
    expect(result.user.includes('삼성전자 프로젝트')).toBe(true);
  });

  it('cfo — returns system/user with json and 손익/정산', () => {
    const input: GenerateProposalInput = {
      engagementId: 'e1',
      domain: 'cfo',
      engagementName: '테스트 딜',
    };
    const result = buildDomainPrompt(input, []);
    expect(result.system.includes('json') || result.user.includes('json')).toBe(true);
    expect(
      result.user.includes('손익') ||
        result.system.includes('손익') ||
        result.user.includes('정산') ||
        result.system.includes('정산'),
    ).toBe(true);
  });

  it('includes recalled memories in prompt', () => {
    const input: GenerateProposalInput = {
      engagementId: 'e1',
      domain: 'sales',
      engagementName: '테스트',
    };
    const result = buildDomainPrompt(input, ['이전 결정: 할인율 10%']);
    expect(
      result.user.includes('이전 결정: 할인율 10%') ||
        result.system.includes('이전 결정: 할인율 10%'),
    ).toBe(true);
  });
});

describe('generateDomainProposal', () => {
  it('returns proposal from mock callLLM', async () => {
    const input: GenerateProposalInput = {
      engagementId: 'e_unit',
      domain: 'sales',
      engagementName: '단위테스트',
    };
    const mockLLM = async () => '{"title":"T","bodyMarkdown":"B"}';
    const mockGetProjectSlug = async () => 'test-project';
    const result = await generateDomainProposal(input, { callLLM: mockLLM, getProjectSlug: mockGetProjectSlug });
    expect(result.title).toBe('T');
    expect(result.bodyMarkdown).toBe('B');
    expect(result.domain).toBe('sales');
  });

  it('propagates callLLM error', async () => {
    const input: GenerateProposalInput = {
      engagementId: 'e_unit',
      domain: 'sales',
      engagementName: '단위테스트',
    };
    const mockLLM = async (): Promise<string> => {
      throw new Error('API_FAIL');
    };
    const mockGetProjectSlug = async () => 'test-project';
    await expect(generateDomainProposal(input, { callLLM: mockLLM, getProjectSlug: mockGetProjectSlug })).rejects.toThrow('API_FAIL');
  });

  it('recalls tag-matched memories into the prompt even when the embedder fails (hybrid degradation)', async () => {
    const memory = await import('./domain-memory');
    (memory.loadDomainMemories as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      {
        domain: 'sales',
        memoryType: 'case',
        key: 'eng:e_recall:sales',
        label: '이전 결정: 할인율 10%',
        tags: ['domain:sales', 'entity:proposal', 'intent:approved'],
        outcome: 'approved',
        confidence: 90,
        status: 'active',
        source: 'human',
      },
    ]);
    const input: GenerateProposalInput = {
      engagementId: 'e_recall',
      domain: 'sales',
      engagementName: '리콜 테스트 딜',
    };
    const seen: string[] = [];
    const failing = async (): Promise<number[]> => {
      throw new Error('embedder down');
    };
    const result = await generateDomainProposal(input, {
      callLLM: async (sys, usr) => {
        seen.push(sys, usr);
        return '{"title":"T","bodyMarkdown":"B"}';
      },
      getProjectSlug: async () => 'test-project',
      embed: failing,
    });
    expect(result.title).toBe('T');
    expect(seen.join('\n')).toContain('이전 결정: 할인율 10%');
  });
});

const integration = process.env.CI_INTEGRATION === '1';
describe.skipIf(!integration)('integration: DomainDecisionLog persistence + getPendingProposals', () => {
  const CASE_REF = 'eng:test_proposal_' + Date.now();
  const engId = CASE_REF.replace('eng:', '');
  // Use real recordDomainDecision (imported via actual module, bypassing the unit-test mock)
  let realRecordDomainDecision: typeof import('./domain-memory').recordDomainDecision;
  let prismaClient: typeof import('@sangfor/db').prisma;

  beforeAll(async () => {
    const domainMemoryActual = await vi.importActual<typeof import('./domain-memory')>('./domain-memory');
    realRecordDomainDecision = domainMemoryActual.recordDomainDecision;
    const db = await import('@sangfor/db');
    prismaClient = db.prisma;
  });

  afterAll(async () => {
    await prismaClient.domainDecisionLog.deleteMany({ where: { caseRef: CASE_REF } });
  });

  it('persists ai_proposal and getPendingProposals returns it', async () => {
    // Directly persist using real DB (bypasses the module-scope mock of recordDomainDecision)
    await realRecordDomainDecision({
      domain: 'presales',
      caseRef: CASE_REF,
      decisionType: 'ai_proposal',
      outputJson: { title: '통합테스트', bodyMarkdown: '**내용**' },
    });
    const pending = await getPendingProposals(engId);
    expect(pending.length).toBeGreaterThan(0);
    expect(pending[0].title).toBe('통합테스트');
    expect(pending[0].domain).toBe('presales');
  });
});

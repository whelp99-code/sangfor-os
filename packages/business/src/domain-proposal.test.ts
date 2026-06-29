import { vi, describe, it, expect, afterAll } from 'vitest';
import { buildDomainPrompt, generateDomainProposal, getPendingProposals } from './domain-proposal';
import type { GenerateProposalInput } from './domain-proposal';

vi.mock('./domain-memory', () => ({
  loadDomainMemories: vi.fn().mockResolvedValue([]),
  recallDomainMemories: vi.fn().mockReturnValue([]),
  recordDomainDecision: vi.fn().mockResolvedValue({ id: 'mock-id' }),
}));

vi.mock('@sangfor/db', () => ({
  Prisma: { JsonNull: null },
  prisma: {
    engagement: {
      findUnique: vi.fn().mockResolvedValue({
        opportunity: { projectId: 'proj-1' },
      }),
    },
    project: {
      findUnique: vi.fn().mockResolvedValue({ slug: 'test-project' }),
    },
    domainDecisionLog: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  },
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
    const result = await generateDomainProposal(input, { callLLM: mockLLM });
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
    await expect(generateDomainProposal(input, { callLLM: mockLLM })).rejects.toThrow('API_FAIL');
  });
});

const integration = process.env.CI_INTEGRATION === '1';
describe.skipIf(!integration)('integration: generateDomainProposal persists + getPendingProposals', () => {
  const CASE_REF = 'eng:test_proposal_' + Date.now();
  const engId = CASE_REF.replace('eng:', '');

  afterAll(async () => {
    const { prisma } = await import('@sangfor/db');
    await prisma.domainDecisionLog.deleteMany({ where: { caseRef: CASE_REF } });
  });

  it('persists ai_proposal and getPendingProposals returns it', async () => {
    const mockLLM = async () => '{"title":"통합테스트","bodyMarkdown":"**내용**"}';
    const result = await generateDomainProposal(
      { engagementId: engId, domain: 'presales', engagementName: '통합테스트 딜' },
      { callLLM: mockLLM },
    );
    expect(result.title).toBe('통합테스트');
    const pending = await getPendingProposals(engId);
    expect(pending.length).toBeGreaterThan(0);
    expect(pending[0].title).toBe('통합테스트');
    expect(pending[0].domain).toBe('presales');
  });
});

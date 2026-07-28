import { describe, expect, it } from 'vitest';
import { ApprovalManager, BreakGlassPolicy, CanonicalWorkflowClient } from '@sangfor/workflow-engine';

const operator = { principalId: 'operator-1', role: 'operator', source: 'api_key' } as const;

describe('WF-01c authority removal', () => {
  it('fails closed when the canonical root is unavailable', async () => {
    const client = new CanonicalWorkflowClient({
      environment: {
        SANGFOR_ROOT_URL: 'http://127.0.0.1:1', INTERNAL_PRINCIPAL_TTL_SECONDS: '60', INTERNAL_PRINCIPAL_CLOCK_SKEW_SECONDS: '5', INTERNAL_PRINCIPAL_ROTATION_OWNER: 'security-auth',
        INTERNAL_PRINCIPAL_WORKFLOW_ACTIVE_KID: 'workflow-1',
        INTERNAL_PRINCIPAL_WORKFLOW_KEYRING_JSON: JSON.stringify({ version: 'sangfor.internal-principal-keyring/v1', keys: [{ kid: 'workflow-1', state: 'active', secretBase64Url: Buffer.alloc(32, 1).toString('base64url') }] }),
      },
      scope: { tenantId: 'tenant-1', companyId: 'company-1', projectId: 'project-1' },
      fetch: async () => { throw new Error('root unavailable'); },
    });
    await expect(client.getRun('run-1')).rejects.toMatchObject({ code: 'ROOT_UNAVAILABLE' });
    expect(client.status()).toEqual({ state: 'degraded' });
  });

  it('does not retain an approvable local workflow across service restart', () => {
    const first = new ApprovalManager();
    expect(() => first.requestApproval({ id: 'wf-1', status: 'draft' } as never)).toThrow(/authority_moved/);
    expect(() => first.approve('wf-1', operator)).toThrow(/authority_moved/);
    expect(new ApprovalManager().listPendingApprovals()).toEqual([]);
  });

  it('keeps break-glass disabled instead of granting an in-memory bypass', () => {
    const policy = new BreakGlassPolicy();
    expect(() => policy.requestBreakGlass('urgent', operator)).toThrow(/disabled|manual-gate/);
    expect(policy.isBreakGlassActive()).toBe(false);
    policy.dispose();
  });
});

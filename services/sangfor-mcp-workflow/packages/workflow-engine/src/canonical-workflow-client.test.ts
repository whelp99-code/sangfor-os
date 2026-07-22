import { describe, expect, it } from 'vitest';
import { CanonicalWorkflowClient } from './canonical-workflow-client.js';

const keyring = JSON.stringify({
  version: 'sangfor.internal-principal-keyring/v1',
  keys: [{
    kid: 'workflow-1', state: 'active', secretBase64Url: Buffer.alloc(32, 7).toString('base64url'),
    activatedAt: '2026-01-01T00:00:00Z', demotedAt: null, verificationCutoff: null, retiredAt: null,
  }],
});

describe('CanonicalWorkflowClient', () => {
  it('fails closed when the root is unavailable and never falls back to local state', async () => {
    const client = new CanonicalWorkflowClient({
      environment: {
        SANGFOR_ROOT_URL: 'http://127.0.0.1:1',
        INTERNAL_PRINCIPAL_TTL_SECONDS: '60',
        INTERNAL_PRINCIPAL_CLOCK_SKEW_SECONDS: '5',
        INTERNAL_PRINCIPAL_ROTATION_OWNER: 'security-auth',
        INTERNAL_PRINCIPAL_WORKFLOW_ACTIVE_KID: 'workflow-1',
        INTERNAL_PRINCIPAL_WORKFLOW_KEYRING_JSON: keyring,
      },
      scope: { tenantId: 'tenant-1', companyId: 'company-1', projectId: 'project-1' },
      fetch: async () => { throw new Error('root unavailable'); },
    });

    await expect(client.getRun('run-1')).rejects.toMatchObject({ code: 'ROOT_UNAVAILABLE' });
    expect(client.status()).toEqual({ state: 'degraded' });
  });

  it('uses the WORKFLOW profile and exact one-capability route binding', async () => {
    const requests: Request[] = [];
    const client = new CanonicalWorkflowClient({
      environment: {
        SANGFOR_ROOT_URL: 'http://root.example',
        INTERNAL_PRINCIPAL_TTL_SECONDS: '60',
        INTERNAL_PRINCIPAL_CLOCK_SKEW_SECONDS: '5',
        INTERNAL_PRINCIPAL_ROTATION_OWNER: 'security-auth',
        INTERNAL_PRINCIPAL_WORKFLOW_ACTIVE_KID: 'workflow-1',
        INTERNAL_PRINCIPAL_WORKFLOW_KEYRING_JSON: keyring,
      },
      scope: { tenantId: 'tenant-1', companyId: 'company-1', projectId: 'project-1' },
      fetch: async (input) => {
        requests.push(input as Request);
        return new Response(JSON.stringify({ run: { id: 'run-1' } }), { status: 200 });
      },
    });

    await expect(client.getRun('run-1')).resolves.toEqual({ id: 'run-1' });
    expect(requests).toHaveLength(1);
    expect(requests[0].headers.get('x-sangfor-internal-principal')).toMatch(/^[^.]+\.[^.]+\.[^.]+$/);
    expect(requests[0].url).toBe('http://root.example/api/workflow-runs/run-1');
  });
});

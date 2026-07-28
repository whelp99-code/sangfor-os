import { describe, expect, it } from 'vitest';
import {
  INTERNAL_PRINCIPAL_KEYRING_VERSION,
  parseInternalPrincipalConfig,
  type ParseInternalPrincipalConfigEnv,
} from '@sangfor/config';

import {
  InternalPrincipalVerificationError,
  issueInternalPrincipal,
  resolveWorkflowRootCapability,
  verifyInternalPrincipal,
} from './internal-principal';

const D = 1_700_000_000;

function rfc3339(seconds: number): string {
  return new Date(seconds * 1_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function keyring(kid: string, byte: number): string {
  return JSON.stringify({
    version: INTERNAL_PRINCIPAL_KEYRING_VERSION,
    keys: [{
      kid, state: 'active', secretBase64Url: Buffer.alloc(32, byte).toString('base64url'),
      activatedAt: rfc3339(D - 100), demotedAt: null, verificationCutoff: null, retiredAt: null,
    }],
  });
}

function configEnv(): ParseInternalPrincipalConfigEnv {
  return {
    INTERNAL_PRINCIPAL_TTL_SECONDS: '60', INTERNAL_PRINCIPAL_CLOCK_SKEW_SECONDS: '5', INTERNAL_PRINCIPAL_ROTATION_OWNER: 'security-auth',
    INTERNAL_PRINCIPAL_FINANCE_ACTIVE_KID: 'finance-1', INTERNAL_PRINCIPAL_FINANCE_KEYRING_JSON: keyring('finance-1', 1),
    INTERNAL_PRINCIPAL_SCHEDULER_ACTIVE_KID: 'scheduler-1', INTERNAL_PRINCIPAL_SCHEDULER_KEYRING_JSON: keyring('scheduler-1', 2),
    INTERNAL_PRINCIPAL_WORKFLOW_ACTIVE_KID: 'workflow-1', INTERNAL_PRINCIPAL_WORKFLOW_KEYRING_JSON: keyring('workflow-1', 3),
    INTERNAL_PRINCIPAL_ENGINEER_ACTIVE_KID: 'engineer-1', INTERNAL_PRINCIPAL_ENGINEER_KEYRING_JSON: keyring('engineer-1', 4),
  };
}

function financeInput(overrides: Record<string, unknown> = {}) {
  return {
    profile: 'FINANCE' as const,
    subjectType: 'human_delegation' as const,
    subjectId: 'human-1',
    sessionId: 'session-1',
    tenantId: 'tenant-1', companyId: 'company-1', projectId: 'project-1',
    businessRole: 'finance_manager' as const,
    capabilities: ['finance.read'] as const,
    method: 'POST', path: '/api/cfo/invoices', query: '?page=1', body: '{"amount":10}',
    idempotencyKey: 'idem-1',
    ...overrides,
  };
}

const fixedRandom = (() => {
  let value = 0;
  return () => Buffer.alloc(16, ++value);
})();

describe('sangfor.internal-principal/v1 compact JWS', () => {
  it('issues a canonical signed finance delegation and preserves the human authority', () => {
    const config = parseInternalPrincipalConfig(configEnv(), D);
    const token = issueInternalPrincipal(financeInput(), config, { now: D, randomBytes: fixedRandom });
    const verified = verifyInternalPrincipal(token, {
      profile: 'FINANCE', method: 'POST', path: '/api/cfo/invoices', query: '?page=1', body: '{"amount":10}',
    }, config, D + 1);
    expect(verified.subjectType).toBe('human_delegation');
    expect(verified.subjectId).toBe('human-1');
    expect(verified.sessionId).toBe('session-1');
    expect(verified.businessRole).toBe('finance_manager');
    expect(verified.capabilities).toEqual(['finance.read']);
    expect(verified.exp).toBe(D + 60);
    expect(verified.nbf).toBe(D - 5);
  });

  it('rejects unsigned, forged, and request-binding changes', () => {
    const config = parseInternalPrincipalConfig(configEnv(), D);
    const token = issueInternalPrincipal(financeInput(), config, { now: D, randomBytes: fixedRandom });
    const [header, payload] = token.split('.');
    expect(() => verifyInternalPrincipal(`${header}.${payload}.forged`, { profile: 'FINANCE', method: 'POST', path: '/api/cfo/invoices', query: '?page=1', body: '{"amount":10}' }, config, D)).toThrow(InternalPrincipalVerificationError);
    expect(() => verifyInternalPrincipal(token, { profile: 'FINANCE', method: 'PATCH', path: '/api/cfo/invoices', query: '?page=1', body: '{"amount":10}' }, config, D)).toThrow(InternalPrincipalVerificationError);
    expect(() => verifyInternalPrincipal(token, { profile: 'FINANCE', method: 'POST', path: '/api/cfo/invoices', query: '?page=2', body: '{"amount":10}' }, config, D)).toThrow(InternalPrincipalVerificationError);
    expect(() => verifyInternalPrincipal(token, { profile: 'FINANCE', method: 'POST', path: '/api/cfo/invoices', query: '?page=1', body: '{"amount":99}' }, config, D)).toThrow(InternalPrincipalVerificationError);
  });

  it('closes every profile to its issuer, audience, service identity, capability, and independent keyring', () => {
    const config = parseInternalPrincipalConfig(configEnv(), D);
    const scheduler = issueInternalPrincipal({
      profile: 'SCHEDULER', subjectType: 'service', subjectId: 'sangfor-scheduler', sessionId: null,
      tenantId: 'tenant-1', companyId: 'company-1', projectId: 'project-1', businessRole: null,
      capabilities: ['agent.schedule.tick'], method: 'POST', path: '/api/agent/schedules/tick', query: '', body: '', idempotencyKey: 'tick-1',
    }, config, { now: D, randomBytes: fixedRandom });
    expect(verifyInternalPrincipal(scheduler, { profile: 'SCHEDULER', method: 'POST', path: '/api/agent/schedules/tick', query: '', body: '' }, config, D)).toMatchObject({ subjectId: 'sangfor-scheduler' });
    expect(() => verifyInternalPrincipal(scheduler, { profile: 'FINANCE', method: 'POST', path: '/api/agent/schedules/tick', query: '', body: '' }, config, D)).toThrow(InternalPrincipalVerificationError);
    expect(() => issueInternalPrincipal({ ...financeInput(), profile: 'FINANCE', capabilities: ['workflow.run.create'] }, config, { now: D, randomBytes: fixedRandom })).toThrow(InternalPrincipalVerificationError);
    expect(resolveWorkflowRootCapability('POST', '/api/workflows/definitions/wf-1/activate')).toBe('workflow.definition.activate');
    expect(resolveWorkflowRootCapability('POST', '/api/workflows/runs/run-1/callback')).toBe('workflow.run.callback');
  });

  it('enforces old-key demotion claims and expiry at D+65', () => {
    const oldSecret = Buffer.alloc(32, 9).toString('base64url');
    const env = {
      ...configEnv(),
      INTERNAL_PRINCIPAL_FINANCE_KEYRING_JSON: JSON.stringify({
      version: INTERNAL_PRINCIPAL_KEYRING_VERSION,
      keys: [
        { kid: 'finance-1', state: 'active', secretBase64Url: Buffer.alloc(32, 1).toString('base64url'), activatedAt: rfc3339(D - 10), demotedAt: null, verificationCutoff: null, retiredAt: null },
        { kid: 'finance-old', state: 'verify_only', secretBase64Url: oldSecret, activatedAt: rfc3339(D - 100), demotedAt: rfc3339(D), verificationCutoff: rfc3339(D + 65), retiredAt: null },
      ],
      }),
    };
    const config = parseInternalPrincipalConfig(env, D + 1);
    const oldConfig = parseInternalPrincipalConfig({ ...configEnv(), INTERNAL_PRINCIPAL_FINANCE_ACTIVE_KID: 'finance-old', INTERNAL_PRINCIPAL_FINANCE_KEYRING_JSON: JSON.stringify({ version: INTERNAL_PRINCIPAL_KEYRING_VERSION, keys: [{ kid: 'finance-old', state: 'active', secretBase64Url: oldSecret, activatedAt: rfc3339(D - 100), demotedAt: null, verificationCutoff: null, retiredAt: null }] }) }, D - 1);
    const oldToken = issueInternalPrincipal(financeInput(), oldConfig, { now: D - 1, randomBytes: fixedRandom });
    expect(verifyInternalPrincipal(oldToken, { profile: 'FINANCE', method: 'POST', path: '/api/cfo/invoices', query: '?page=1', body: '{"amount":10}' }, config, D + 1).iat).toBe(D - 1);
    expect(() => verifyInternalPrincipal(oldToken, { profile: 'FINANCE', method: 'POST', path: '/api/cfo/invoices', query: '?page=1', body: '{"amount":10}' }, config, D + 66)).toThrow(InternalPrincipalVerificationError);
  });
});

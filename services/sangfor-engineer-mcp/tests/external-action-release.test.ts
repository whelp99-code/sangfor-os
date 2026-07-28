import { describe, expect, it } from 'vitest';
import { issueEngineerInternalPrincipal, parseEngineerInternalPrincipalConfig } from '../packages/sangfor-approval/src/internal-principal-client.js';

describe('external action release hardening', () => {
  it('creates only a request-bound ENGINEER envelope; plaintext approval fields are absent', () => {
    const env = { SANGFOR_ROOT_URL: 'http://127.0.0.1:3101', INTERNAL_PRINCIPAL_TTL_SECONDS: '60', INTERNAL_PRINCIPAL_CLOCK_SKEW_SECONDS: '5', INTERNAL_PRINCIPAL_ROTATION_OWNER: 'security-auth', INTERNAL_PRINCIPAL_ENGINEER_ACTIVE_KID: 'engineer-1', INTERNAL_PRINCIPAL_ENGINEER_KEYRING_JSON: JSON.stringify({ version: 'sangfor.internal-principal-keyring/v1', keys: [{ kid: 'engineer-1', state: 'active', secretBase64Url: Buffer.alloc(32, 1).toString('base64url'), activatedAt: '2026-01-01T00:00:00Z', demotedAt: null, verificationCutoff: null, retiredAt: null }] }) };
    const token = issueEngineerInternalPrincipal({ tenantId: 'tenant', companyId: 'company', projectId: 'project', method: 'POST', path: '/api/internal/external-actions/receipts/consume', query: '', body: '{"receipt":"r"}', idempotencyKey: 'key' }, parseEngineerInternalPrincipalConfig(env), { now: 1_700_000_000, randomBytes: () => Buffer.alloc(16, 2) });
    expect(Buffer.from(token.split('.')[1]!, 'base64url').toString('utf8')).not.toContain('approvedBy');
  });
});

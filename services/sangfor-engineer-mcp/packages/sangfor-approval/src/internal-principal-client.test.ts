import { describe, expect, it } from 'vitest';
import { issueEngineerInternalPrincipal, parseEngineerInternalPrincipalConfig } from './internal-principal-client.js';

const keyring = JSON.stringify({ version: 'sangfor.internal-principal-keyring/v1', keys: [{ kid: 'engineer-1', state: 'active', secretBase64Url: Buffer.alloc(32, 4).toString('base64url'), activatedAt: '2026-01-01T00:00:00Z', demotedAt: null, verificationCutoff: null, retiredAt: null }] });
const env = { SANGFOR_ROOT_URL: 'http://127.0.0.1:3101', INTERNAL_PRINCIPAL_TTL_SECONDS: '60', INTERNAL_PRINCIPAL_CLOCK_SKEW_SECONDS: '5', INTERNAL_PRINCIPAL_ROTATION_OWNER: 'security-auth', INTERNAL_PRINCIPAL_ENGINEER_ACTIVE_KID: 'engineer-1', INTERNAL_PRINCIPAL_ENGINEER_KEYRING_JSON: keyring };

describe('ENGINEER internal principal signer', () => {
  it('uses only the exact ENGINEER profile and fails closed for absent or malformed key configuration', () => {
    const config = parseEngineerInternalPrincipalConfig(env);
    const token = issueEngineerInternalPrincipal({ tenantId: 'tenant-1', companyId: 'company-1', projectId: 'project-1', method: 'POST', path: '/api/internal/external-actions/receipts/consume', query: '', body: '{"receipt":"x"}', idempotencyKey: 'consume-1' }, config, { now: 1_700_000_000, randomBytes: () => Buffer.alloc(16, 1) });
    expect(token.split('.')).toHaveLength(3);
    expect(() => parseEngineerInternalPrincipalConfig({ ...env, INTERNAL_PRINCIPAL_ENGINEER_KEYRING_JSON: '{}' })).toThrow();
  });
});

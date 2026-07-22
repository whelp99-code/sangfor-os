import { describe, expect, it } from 'vitest';

import {
  INTERNAL_PRINCIPAL_CLOCK_SKEW_SECONDS,
  INTERNAL_PRINCIPAL_KEYRING_VERSION,
  INTERNAL_PRINCIPAL_ROTATION_OWNER,
  INTERNAL_PRINCIPAL_TTL_SECONDS,
  InternalPrincipalConfigError,
  parseInternalPrincipalConfig,
  type InternalPrincipalKeyringEntry,
  type ParseInternalPrincipalConfigEnv,
} from './internal-principal';

const D = 1_700_000_000;

function rfc3339(seconds: number): string {
  return new Date(seconds * 1_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function secret(byte: number): string {
  return Buffer.alloc(32, byte).toString('base64url');
}

function active(kid: string, byte: number): InternalPrincipalKeyringEntry {
  return {
    kid,
    state: 'active',
    secretBase64Url: secret(byte),
    activatedAt: rfc3339(D - 100),
    demotedAt: null,
    verificationCutoff: null,
    retiredAt: null,
  };
}

function profileEnv(prefix: string, kid: string, byte: number): Record<string, string> {
  return {
    [`${prefix}_ACTIVE_KID`]: kid,
    [`${prefix}_KEYRING_JSON`]: JSON.stringify({
      version: INTERNAL_PRINCIPAL_KEYRING_VERSION,
      keys: [active(kid, byte)],
    }),
  };
}

function env(overrides: Partial<ParseInternalPrincipalConfigEnv> = {}): ParseInternalPrincipalConfigEnv {
  return {
    INTERNAL_PRINCIPAL_TTL_SECONDS: '60',
    INTERNAL_PRINCIPAL_CLOCK_SKEW_SECONDS: '5',
    INTERNAL_PRINCIPAL_ROTATION_OWNER: 'security-auth',
    ...profileEnv('INTERNAL_PRINCIPAL_FINANCE', 'finance-1', 1),
    ...profileEnv('INTERNAL_PRINCIPAL_SCHEDULER', 'scheduler-1', 2),
    ...profileEnv('INTERNAL_PRINCIPAL_WORKFLOW', 'workflow-1', 3),
    ...profileEnv('INTERNAL_PRINCIPAL_ENGINEER', 'engineer-1', 4),
    ...overrides,
  };
}

describe('internal-principal config boundary', () => {
  it('pins the global protocol timing and sole rotation owner', () => {
    expect(INTERNAL_PRINCIPAL_TTL_SECONDS).toBe(60);
    expect(INTERNAL_PRINCIPAL_CLOCK_SKEW_SECONDS).toBe(5);
    expect(INTERNAL_PRINCIPAL_ROTATION_OWNER).toBe('security-auth');
  });

  it('requires four independent exact-profile keyrings', () => {
    const parsed = parseInternalPrincipalConfig(env(), D);
    expect(Object.keys(parsed.profiles).sort()).toEqual(['ENGINEER', 'FINANCE', 'SCHEDULER', 'WORKFLOW']);
    expect(parsed.profiles.FINANCE.issuer).toBe('sangfor-web');
    expect(parsed.profiles.FINANCE.audience).toBe('sangfor-api-finance');
    expect(parsed.profiles.SCHEDULER.serviceId).toBe('sangfor-scheduler');
    expect(parsed.profiles.WORKFLOW.capabilities).toContain('workflow.run.callback');
    expect(parsed.profiles.ENGINEER.capabilities).toEqual(['external_action.receipt.consume']);
  });

  it('rejects profile key reuse even when the key ids differ', () => {
    const bad = env({
      INTERNAL_PRINCIPAL_SCHEDULER_KEYRING_JSON: JSON.stringify({
        version: INTERNAL_PRINCIPAL_KEYRING_VERSION,
        keys: [active('scheduler-1', 1)],
      }),
    });
    expect(() => parseInternalPrincipalConfig(bad, D)).toThrow(InternalPrincipalConfigError);
  });

  it('rejects a malformed keyring, missing active key, or unbounded old key', () => {
    const noActive = {
      kid: 'old-finance', state: 'verify_only', secretBase64Url: secret(9),
      activatedAt: rfc3339(D - 100), demotedAt: rfc3339(D), verificationCutoff: rfc3339(D + 999), retiredAt: null,
    } satisfies InternalPrincipalKeyringEntry;
    expect(() => parseInternalPrincipalConfig(env({
      INTERNAL_PRINCIPAL_FINANCE_KEYRING_JSON: JSON.stringify({ version: INTERNAL_PRINCIPAL_KEYRING_VERSION, keys: [noActive] }),
    }), D)).toThrow(InternalPrincipalConfigError);

    const malformed = active('finance-1', 1) as unknown as Record<string, unknown>;
    malformed.extra = true;
    expect(() => parseInternalPrincipalConfig(env({
      INTERNAL_PRINCIPAL_FINANCE_KEYRING_JSON: JSON.stringify({ version: INTERNAL_PRINCIPAL_KEYRING_VERSION, keys: [malformed] }),
    }), D)).toThrow(InternalPrincipalConfigError);
  });

  it('enforces the exact D+65 demotion cutoff and mandatory secret-free retirement', () => {
    const old: InternalPrincipalKeyringEntry = {
      kid: 'finance-old', state: 'verify_only', secretBase64Url: secret(9),
      activatedAt: rfc3339(D - 10), demotedAt: rfc3339(D), verificationCutoff: rfc3339(D + 65), retiredAt: null,
    };
    const good = parseInternalPrincipalConfig(env({
      INTERNAL_PRINCIPAL_FINANCE_KEYRING_JSON: JSON.stringify({
        version: INTERNAL_PRINCIPAL_KEYRING_VERSION,
        keys: [active('finance-1', 1), old],
      }),
    }), D + 65);
    expect(good.profiles.FINANCE.verifyOnly.get('finance-old')?.verificationCutoffSeconds).toBe(D + 65);
    expect(() => parseInternalPrincipalConfig(env({
      INTERNAL_PRINCIPAL_FINANCE_KEYRING_JSON: JSON.stringify({ version: INTERNAL_PRINCIPAL_KEYRING_VERSION, keys: [active('finance-1', 1), old] }),
    }), D + 66)).toThrow(InternalPrincipalConfigError);
  });
});

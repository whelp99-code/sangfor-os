import { createServer } from 'node:http';
import express, { type Express } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { signSessionJwt } from '@sangfor/auth';

const prismaMocks = vi.hoisted(() => ({
  authSessionFindUnique: vi.fn(),
  userFindUnique: vi.fn(),
}));

vi.mock('@sangfor/db', () => ({
  prisma: {
    authSession: { findUnique: prismaMocks.authSessionFindUnique },
    user: { findUnique: prismaMocks.userFindUnique },
  },
}));

const ACTIVE_KID = 'persisted-session-test-key-1';
const ACTIVE_SECRET = Buffer.alloc(32, 6);

function userJwtEnv(): Record<string, string> {
  const activatedAt = new Date(Date.now() - 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  return {
    USER_JWT_ACTIVE_KID: ACTIVE_KID,
    USER_JWT_ROTATION_OWNER: 'security-auth',
    USER_JWT_ISSUER: 'sangfor-os',
    USER_JWT_AUDIENCE: 'sangfor-os-runtime',
    USER_JWT_TTL_SECONDS: '900',
    USER_JWT_CLOCK_SKEW_SECONDS: '30',
    USER_JWT_KEYRING_JSON: JSON.stringify({
      version: 'sangfor.user-jwt-keyring/v1',
      keys: [
        {
          kid: ACTIVE_KID,
          state: 'active',
          secretBase64Url: ACTIVE_SECRET.toString('base64url'),
          activatedAt,
          demotedAt: null,
          verifyUntil: null,
          retiredAt: null,
        },
      ],
    }),
  };
}

async function requestProbe(app: Express, bearerToken?: string): Promise<{ status: number; body: unknown }> {
  const server = createServer(app);
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen({ host: '127.0.0.1', port: 0, exclusive: true }, () => resolveListen());
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    server.close();
    throw new TypeError('Expected an ephemeral TCP listener');
  }
  try {
    const headers: Record<string, string> = { connection: 'close' };
    if (bearerToken) headers.authorization = `Bearer ${bearerToken}`;
    const response = await fetch(`http://127.0.0.1:${address.port}/probe`, { headers });
    const body = await response.json().catch(() => undefined);
    return { status: response.status, body };
  } finally {
    await new Promise<void>((resolveClose, rejectClose) => {
      server.close((error) => (error ? rejectClose(error) : resolveClose()));
    });
  }
}

async function buildApp(): Promise<Express> {
  vi.resetModules();
  const { authMiddleware } = await import('./auth');
  const app = express();
  app.use(authMiddleware);
  app.get('/probe', (request, response) => {
    response.json({ principalId: request.authContext?.userId, tenantId: request.authContext?.tenantId });
  });
  return app;
}

const NOW = Math.floor(Date.now() / 1000);

function mintToken(overrides: { sub?: string; tenantId?: string; companyId?: string; projectId?: string } = {}): string {
  return signSessionJwt(
    {
      sub: overrides.sub ?? 'user-1',
      jti: 'persisted-session-jti',
      tenantId: overrides.tenantId ?? 'tenant-1',
      companyId: overrides.companyId ?? 'company-1',
      projectId: overrides.projectId ?? 'project-1',
      product: 'portal',
      nowSeconds: NOW,
    },
    {
      issuer: 'sangfor-os',
      audience: 'sangfor-os-runtime',
      algorithm: 'HS256',
      claimsVersion: 'sangfor.user-session/v1',
      ttlSeconds: 900,
      clockSkewSeconds: 30,
      rotationOwner: 'security-auth',
      activeKid: ACTIVE_KID,
      active: { kid: ACTIVE_KID, secret: ACTIVE_SECRET, activatedAtSeconds: NOW - 60 },
      verifyOnly: new Map(),
      retiredKids: new Set(),
    },
  );
}

const ACTIVE_USER = { id: 'user-1', status: 'active', disabledAt: null };

function liveSession(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'persisted-session-jti',
    userId: 'user-1',
    tenantId: 'tenant-1',
    companyId: 'company-1',
    projectId: 'project-1',
    issuedAt: new Date((NOW - 60) * 1000),
    expiresAt: new Date((NOW + 840) * 1000),
    revokedAt: null,
    mfaVerifiedAt: null,
    mfaMethod: null,
    ...overrides,
  };
}

describe('authMiddleware — persisted session enforcement (U014/SEC-01)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const [key, value] of Object.entries(userJwtEnv())) vi.stubEnv(key, value);
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('AUTH_PROFILE', '');
    vi.stubEnv('AUTH_BYPASS_ENABLED', '0');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('denies a cryptographically valid session-JWT with no DB session at all', async () => {
    prismaMocks.authSessionFindUnique.mockResolvedValueOnce(null);
    const app = await buildApp();

    const result = await requestProbe(app, mintToken());

    expect(result.status).toBe(401);
    expect(prismaMocks.userFindUnique).not.toHaveBeenCalled();
  });

  it('denies a revoked session', async () => {
    prismaMocks.authSessionFindUnique.mockResolvedValueOnce(liveSession({ revokedAt: new Date() }));
    prismaMocks.userFindUnique.mockResolvedValueOnce(ACTIVE_USER);
    const app = await buildApp();

    const result = await requestProbe(app, mintToken());

    expect(result.status).toBe(401);
  });

  it('denies an expired session', async () => {
    prismaMocks.authSessionFindUnique.mockResolvedValueOnce(liveSession({ expiresAt: new Date((NOW - 10) * 1000) }));
    prismaMocks.userFindUnique.mockResolvedValueOnce(ACTIVE_USER);
    const app = await buildApp();

    const result = await requestProbe(app, mintToken());

    expect(result.status).toBe(401);
  });

  it('denies a disabled user even with a live, unexpired, unrevoked session', async () => {
    prismaMocks.authSessionFindUnique.mockResolvedValueOnce(liveSession());
    prismaMocks.userFindUnique.mockResolvedValueOnce({ id: 'user-1', status: 'disabled', disabledAt: new Date() });
    const app = await buildApp();

    const result = await requestProbe(app, mintToken());

    expect(result.status).toBe(401);
  });

  it.each([[null], ['legacy_pending']])('denies a legacy %s user', async (status) => {
    prismaMocks.authSessionFindUnique.mockResolvedValueOnce(liveSession());
    prismaMocks.userFindUnique.mockResolvedValueOnce({ id: 'user-1', status, disabledAt: null });
    const app = await buildApp();

    const result = await requestProbe(app, mintToken());

    expect(result.status).toBe(401);
  });

  it('denies a JWT-vs-DB scope mismatch (claims carry a different tenantId than the persisted session)', async () => {
    prismaMocks.authSessionFindUnique.mockResolvedValueOnce(liveSession({ tenantId: 'tenant-1' }));
    prismaMocks.userFindUnique.mockResolvedValueOnce(ACTIVE_USER);
    const app = await buildApp();

    const result = await requestProbe(app, mintToken({ tenantId: 'evil-tenant' }));

    expect(result.status).toBe(401);
  });

  it('never falls through to the legacy TokenManager path for a structurally-valid session-JWT that fails the DB check', async () => {
    prismaMocks.authSessionFindUnique.mockResolvedValueOnce(null);
    const app = await buildApp();

    const result = await requestProbe(app, mintToken());

    // 401, not the local_mock/dev fixture and not a TokenManager-derived context.
    expect(result.status).toBe(401);
  });

  it('admits an active, non-privileged session (trusted fixture) and attaches the resolved identity', async () => {
    prismaMocks.authSessionFindUnique.mockResolvedValueOnce(liveSession());
    prismaMocks.userFindUnique.mockResolvedValueOnce(ACTIVE_USER);
    const app = await buildApp();

    const result = await requestProbe(app, mintToken());

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ principalId: 'user-1', tenantId: 'tenant-1' });
  });
});

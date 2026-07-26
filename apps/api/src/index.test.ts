import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import type { Server as HttpServer } from 'node:http';
import type { Socket } from 'node:net';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFile } from 'node:fs/promises';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const infraSpies = vi.hoisted(() => ({
  call: vi.fn(async () => ({ result: { ok: true } })),
  list: vi.fn(async () => [{ name: 'sangfor.products' }]),
}));

vi.mock('@sangfor/infra', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@sangfor/infra')>();
  return { ...actual, callMcpTool: infraSpies.call, listMcpTools: infraSpies.list };
});

// U014/SEC-01: this file's DATABASE_URL is deliberately unreachable (see beforeAll below), so the
// persisted-session lookup authMiddleware now performs for a canonical session-JWT must be
// mocked here, the same way infra is mocked above — no route this file exercises needs any other
// Prisma model.
const dbMocks = vi.hoisted(() => ({
  authSessionFindUnique: vi.fn(async () => null as unknown),
  userFindUnique: vi.fn(async () => null as unknown),
}));

vi.mock('@sangfor/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@sangfor/db')>();
  return {
    ...actual,
    prisma: {
      ...actual.prisma,
    authSession: { findUnique: dbMocks.authSessionFindUnique },
    user: { findUnique: dbMocks.userFindUnique },
    },
  };
});

const API_KEY = 'u002-valid-operator-key-000000000';
const FINANCE_API_KEY = 'u002-valid-finance-key-00000000';
const WEBHOOK_CLIENT_STATE = 'u002-webhook-client-state';
const API_PRINCIPAL = 'apikey:default';
const IDENTITY_FIELDS = [
  'approvedBy',
  'actorId',
  'requestedBy',
  'requester',
  'approver',
  'approverId',
  'approverPersonaId',
  'personaId',
] as const;
const CONFLICT_CASES = IDENTITY_FIELDS.flatMap((field) => [
  [`${field} at root`, { [field]: 'caller-controlled' }],
  [`${field} in object`, { nested: { [field]: 'caller-controlled' } }],
  [`${field} in array`, { nested: [{ [field]: 'caller-controlled' }] }],
] as const);
const apiDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tsxCli = resolve(apiDirectory, 'node_modules/tsx/dist/cli.mjs');
const apiEntrypoint = resolve(apiDirectory, 'src/index.ts');

const ACTIVE_KID = 'api-index-test-key-1';
const ACTIVE_SECRET = Buffer.alloc(32, 3);
const USER_JWT_ISS = 'sangfor-os';
const USER_JWT_AUD = 'sangfor-os-runtime';
const USER_JWT_VER = 'sangfor.user-session/v1';

function userJwtEnv(): Record<string, string> {
  const activatedAt = new Date(Date.now() - 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  return {
    USER_JWT_ACTIVE_KID: ACTIVE_KID,
    USER_JWT_ROTATION_OWNER: 'security-auth',
    USER_JWT_ISSUER: USER_JWT_ISS,
    USER_JWT_AUDIENCE: USER_JWT_AUD,
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

function internalPrincipalEnv(): Record<string, string> {
  const activatedAt = new Date(Date.now() - 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const ring = (kid: string, byte: number) => JSON.stringify({
    version: 'sangfor.internal-principal-keyring/v1',
    keys: [{ kid, state: 'active', secretBase64Url: Buffer.alloc(32, byte).toString('base64url'), activatedAt, demotedAt: null, verificationCutoff: null, retiredAt: null }],
  });
  return {
    INTERNAL_PRINCIPAL_TTL_SECONDS: '60', INTERNAL_PRINCIPAL_CLOCK_SKEW_SECONDS: '5', INTERNAL_PRINCIPAL_ROTATION_OWNER: 'security-auth',
    INTERNAL_PRINCIPAL_FINANCE_ACTIVE_KID: 'finance', INTERNAL_PRINCIPAL_FINANCE_KEYRING_JSON: ring('finance', 1),
    INTERNAL_PRINCIPAL_SCHEDULER_ACTIVE_KID: 'scheduler', INTERNAL_PRINCIPAL_SCHEDULER_KEYRING_JSON: ring('scheduler', 2),
    INTERNAL_PRINCIPAL_WORKFLOW_ACTIVE_KID: 'workflow', INTERNAL_PRINCIPAL_WORKFLOW_KEYRING_JSON: ring('workflow', 3),
    INTERNAL_PRINCIPAL_ENGINEER_ACTIVE_KID: 'engineer', INTERNAL_PRINCIPAL_ENGINEER_KEYRING_JSON: ring('engineer', 4),
  };
}

function b64url(input: Buffer | string): string {
  return (typeof input === 'string' ? Buffer.from(input, 'utf8') : input).toString('base64url');
}

function hmac(secret: Buffer, data: string): Buffer {
  return createHmac('sha256', secret).update(data, 'utf8').digest();
}

function craftToken(header: unknown, payload: unknown, secret: Buffer = ACTIVE_SECRET): string {
  const h = b64url(JSON.stringify(header));
  const p = b64url(JSON.stringify(payload));
  const sig = b64url(hmac(secret, `${h}.${p}`));
  return `${h}.${p}.${sig}`;
}

function validClaims(now: number, overrides: Record<string, unknown> = {}) {
  return {
    iss: USER_JWT_ISS,
    aud: USER_JWT_AUD,
    ver: USER_JWT_VER,
    sub: 'operator-1',
    jti: 'index-test-jti-1',
    iat: now,
    exp: now + 900,
    nbf: now,
    ...overrides,
  };
}

function validBearerToken(): string {
  const now = Math.floor(Date.now() / 1000);
  return craftToken({ alg: 'HS256', kid: ACTIVE_KID, typ: 'JWT' }, validClaims(now));
}

let baseUrl = '';
let server: HttpServer | undefined;
let assignedPort = 0;
const sockets = new Set<Socket>();
let teardownPromise: Promise<void> | undefined;
let cleanupEvidence: Record<string, unknown> | undefined;

function fetchClose(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('connection', 'close');
  return fetch(`${baseUrl}${path}`, { ...init, headers });
}

function apiKeyHeaders(key = API_KEY): Record<string, string> {
  return { 'x-api-key': key };
}

function postTool(argumentsValue: Readonly<Record<string, unknown>>, key = API_KEY): Promise<Response> {
  return fetchClose('/api/whelp99/tools/call', {
    method: 'POST',
    headers: { ...apiKeyHeaders(key), 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'sangfor.products', arguments: argumentsValue }),
  });
}

/**
 * Runs once, idempotently, from `afterAll`, a `finally`-equivalent test
 * teardown, and (best-effort) a termination signal — exactly the U013
 * ephemeral-server lifecycle: stop accepting, drain idle/active sockets,
 * await the close callback with a bounded timeout, wait for the tracked
 * socket set to reach zero, assert listener/address are cleared, then prove
 * a separate probe can exclusively rebind the exact same port. A failure
 * anywhere in here must fail the file even if every HTTP assertion passed.
 */
async function teardown(): Promise<void> {
  if (teardownPromise) return teardownPromise;
  teardownPromise = (async () => {
    const target = server;
    if (!target) return;

  await new Promise<void>((resolveClose, rejectClose) => {
    const timer = setTimeout(() => rejectClose(new Error('server.close callback timed out')), 5_000);
    target.close((err) => {
      clearTimeout(timer);
      if (err) rejectClose(err);
      else resolveClose();
    });
    target.closeIdleConnections();
    target.closeAllConnections();
  });

  const socketDeadline = Date.now() + 5_000;
  while (sockets.size > 0 && Date.now() < socketDeadline) {
    await new Promise((r) => setTimeout(r, 10));
  }
  if (sockets.size !== 0) {
    throw new Error(`tracked socket set did not reach zero: ${sockets.size} remaining`);
  }
  if (target.listening !== false) throw new Error('server.listening did not become false');
  if (target.address() !== null) throw new Error('server.address() did not become null');

  const probe = createServer();
  await new Promise<void>((resolveListen, rejectListen) => {
    probe.once('error', rejectListen);
    probe.listen({ host: '127.0.0.1', port: assignedPort, exclusive: true }, () => resolveListen());
  });
  const probeBound = probe.address() !== null;
  await new Promise<void>((resolveProbeClose, rejectProbeClose) => {
    probe.close((err) => (err ? rejectProbeClose(err) : resolveProbeClose()));
  });
  if (probe.address() !== null) throw new Error('probe.address() did not become null after close');

  cleanupEvidence = {
    closeCompleted: true,
    trackedSocketCount: sockets.size,
    listening: target.listening,
    address: target.address(),
    assignedPort,
    sameportRebindSuccess: probeBound,
    probeAddressAfterClose: probe.address(),
  };

    const evidenceDir = process.env.U013_EVIDENCE_DIR;
    if (evidenceDir) {
      await writeFile(`${evidenceDir}/cleanup.json`, JSON.stringify(cleanupEvidence, null, 2));
    }
  })();
  return teardownPromise;
}

function onTerminationSignal(): void {
  void teardown();
}

beforeAll(async () => {
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('DATABASE_URL', 'postgresql://u002:u002@127.0.0.1:1/u002_gate33');
  vi.stubEnv('API_KEY', API_KEY);
  vi.stubEnv('FINANCE_API_KEY', FINANCE_API_KEY);
  vi.stubEnv('SANGFOR_API_KEY', 'u002-root-to-bridge-key');
  vi.stubEnv('SANGFOR_OPERATOR_PRINCIPAL_ID', 'u002-local-operator');
  vi.stubEnv('NEXTAUTH_SECRET', 'index-security-test-secret-32-characters');
  vi.stubEnv('NEXTAUTH_URL', 'http://localhost:3101');
  vi.stubEnv('MICROSOFT_TENANT_ID', 'index-security-test-tenant');
  vi.stubEnv('MICROSOFT_CLIENT_ID', 'index-security-test-client');
  vi.stubEnv('MICROSOFT_CLIENT_SECRET', 'index-security-test-client-secret');
  vi.stubEnv('WEBHOOK_CLIENT_STATE', WEBHOOK_CLIENT_STATE);
  for (const [key, value] of Object.entries(userJwtEnv())) vi.stubEnv(key, value);
  for (const [key, value] of Object.entries(internalPrincipalEnv())) vi.stubEnv(key, value);

  // U013: importing the module alone must never open a network listener —
  // index.ts's own `.listen()` call is guarded by `isEntrypoint` (this file
  // is never the direct entrypoint under the test runner), so `createApp()`
  // below returns a bare, unlisted Express app. (The separate U002 IPC
  // handler registration is gated on `process.send`/`process.connected`,
  // which Vitest's own worker process legitimately satisfies when run under
  // a forked pool — that is Vitest's IPC, unrelated to this test's HTTP
  // listener lifecycle, so it is intentionally not asserted here.)
  const { createApp } = await import('./index');

  const app = createApp();
  server = createServer(app);
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  process.once('SIGTERM', onTerminationSignal);
  process.once('SIGINT', onTerminationSignal);

  await new Promise<void>((resolveListen, rejectListen) => {
    server?.once('error', rejectListen);
    server?.listen({ host: '127.0.0.1', port: 0, exclusive: true }, () => resolveListen());
  });
  const address = server.address();
  if (address === null || typeof address === 'string' || address.port <= 0) {
    throw new TypeError('Expected a positive TCP port from server.address()');
  }
  assignedPort = address.port;
  baseUrl = `http://127.0.0.1:${assignedPort}`;
  console.log(`[U013 api-http] assigned port ${assignedPort}`);
});

afterAll(async () => {
  process.off('SIGTERM', onTerminationSignal);
  process.off('SIGINT', onTerminationSignal);
  await teardown();
  vi.unstubAllEnvs();
  expect(cleanupEvidence?.closeCompleted).toBe(true);
  expect(cleanupEvidence?.trackedSocketCount).toBe(0);
  expect(cleanupEvidence?.listening).toBe(false);
  expect(cleanupEvidence?.address).toBeNull();
  expect(cleanupEvidence?.sameportRebindSuccess).toBe(true);
  expect(cleanupEvidence?.probeAddressAfterClose).toBeNull();
});

beforeEach(() => {
  infraSpies.call.mockClear();
  infraSpies.list.mockClear();
});

describe('root MCP transport authority', () => {
  it.each(['GET', 'POST'])('rejects missing API key before %s infra access', async (method) => {
    // Given: a request with no root authority credential.
    const request = method === 'GET'
      ? fetchClose('/api/whelp99/tools')
      : fetchClose('/api/whelp99/tools/call', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });

    // When: the real Express route handles the request.
    const response = await request;

    // Then: it returns 401 and neither infra operation is reached.
    expect(response.status).toBe(401);
    expect(infraSpies.list).toHaveBeenCalledTimes(0);
    expect(infraSpies.call).toHaveBeenCalledTimes(0);
  });

  it.each(['GET', 'POST'])('rejects finance authority with 403 before %s infra access', async (method) => {
    // Given: a valid finance API key whose local role is not system_admin.
    const request = method === 'GET'
      ? fetchClose('/api/whelp99/tools', { headers: apiKeyHeaders(FINANCE_API_KEY) })
      : postTool({}, FINANCE_API_KEY);

    // When: the real Express route handles the request.
    const response = await request;

    // Then: it returns 403 and neither infra operation is reached.
    expect(response.status).toBe(403);
    expect(infraSpies.list).toHaveBeenCalledTimes(0);
    expect(infraSpies.call).toHaveBeenCalledTimes(0);
  });

  it('allows the API system administrator to list tools', async () => {
    // Given: the server-registered root API key.
    // When: GET crosses the real Express guard chain.
    const response = await fetchClose('/api/whelp99/tools', { headers: apiKeyHeaders() });

    // Then: infra is reached once and the tool list is returned.
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ tools: [{ name: 'sangfor.products' }] });
    expect(infraSpies.list).toHaveBeenCalledOnce();
  });

  it.each(CONFLICT_CASES)('rejects %s before POST infra access', async (_label, argumentsValue) => {
    // Given: one of the exact eight identity fields conflicts at a root or nested position.
    // When: the API system administrator submits the tool call.
    const response = await postTool(argumentsValue);

    // Then: conflict is exact and the infra call count remains zero.
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'IDENTITY_CONFLICT' });
    expect(infraSpies.call).toHaveBeenCalledTimes(0);
  });

  it('strips all matching recursive identities before POST infra access', async () => {
    // Given: all eight fields redundantly equal the root system administrator.
    const argumentsValue = {
      keep: 'value',
      approvedBy: API_PRINCIPAL,
      nested: {
        actorId: API_PRINCIPAL,
        requestedBy: API_PRINCIPAL,
        entries: [
          { requester: API_PRINCIPAL, approver: API_PRINCIPAL },
          { approverId: API_PRINCIPAL, approverPersonaId: API_PRINCIPAL, personaId: API_PRINCIPAL },
        ],
      },
    };

    // When: the valid request crosses the real Express route.
    const response = await postTool(argumentsValue);

    // Then: only non-identity data reaches infra.
    expect(response.status).toBe(200);
    expect(infraSpies.call).toHaveBeenCalledWith('sangfor.products', {
      keep: 'value',
      nested: { entries: [{}, {}] },
    });
  });
});

describe('finance transport cannot become human authority (U026)', () => {
  it('rejects a valid finance API key when the signed human envelope is absent', async () => {
    const response = await fetchClose('/api/cfo/not-a-route', { headers: apiKeyHeaders(FINANCE_API_KEY) });
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'INTERNAL_PRINCIPAL_REQUIRED' });
  });

  it('rejects a present forged envelope rather than falling back to the transport key identity', async () => {
    const response = await fetchClose('/api/cfo/not-a-route', { headers: { ...apiKeyHeaders(FINANCE_API_KEY), 'x-sangfor-internal-principal': 'forged.unsigned.principal' } });
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'INVALID_INTERNAL_PRINCIPAL' });
  });
});

describe('bearer session JWT HTTP matrix (U013 — GET /api/metrics)', () => {
  it('accepts one valid bearer token with 200', async () => {
    const token = validBearerToken();
    dbMocks.authSessionFindUnique.mockResolvedValueOnce({
      id: 'index-test-jti-1',
      userId: 'operator-1',
      tenantId: 'tenant-1',
      companyId: 'company-1',
      projectId: 'project-1',
      issuedAt: new Date(),
      expiresAt: new Date(Date.now() + 900_000),
      revokedAt: null,
      mfaVerifiedAt: null,
      mfaMethod: null,
    });
    dbMocks.userFindUnique.mockResolvedValueOnce({ id: 'operator-1', status: 'active', disabledAt: null });
    const response = await fetchClose('/api/metrics', { headers: { authorization: `Bearer ${token}` } });
    console.log(`[U013 api-http] valid bearer -> ${response.status}`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/plain');
  });

  it.each([
    ['missing token', undefined],
    ['malformed token', 'not-a-jwt'],
    ['legacy 2-segment token', (() => {
      const t = validBearerToken();
      const [h, p] = t.split('.');
      return `${h}.${p}`;
    })()],
    ['tampered signature', (() => {
      const t = validBearerToken();
      const [h, p, s] = t.split('.');
      const flipped = s.slice(0, -1) + (s.at(-1) === 'A' ? 'B' : 'A');
      return `${h}.${p}.${flipped}`;
    })()],
    ['alg=none forged', craftToken({ alg: 'none', kid: ACTIVE_KID, typ: 'JWT' }, validClaims(Math.floor(Date.now() / 1000)))],
    ['wrong issuer', craftToken({ alg: 'HS256', kid: ACTIVE_KID, typ: 'JWT' }, validClaims(Math.floor(Date.now() / 1000), { iss: 'evil-issuer' }))],
    ['wrong audience', craftToken({ alg: 'HS256', kid: ACTIVE_KID, typ: 'JWT' }, validClaims(Math.floor(Date.now() / 1000), { aud: 'evil-audience' }))],
    ['unknown kid', craftToken({ alg: 'HS256', kid: 'unknown-kid', typ: 'JWT' }, validClaims(Math.floor(Date.now() / 1000)))],
    ['expired token', craftToken({ alg: 'HS256', kid: ACTIVE_KID, typ: 'JWT' }, validClaims(Math.floor(Date.now() / 1000) - 2000, { exp: Math.floor(Date.now() / 1000) - 1100 }))],
    ['mock token string', 'mock.session'],
  ] as const)('rejects %s with 401', async (_label, token) => {
    const headers: Record<string, string> = {};
    if (token !== undefined) headers.authorization = `Bearer ${token}`;
    const response = await fetchClose('/api/metrics', { headers });
    console.log(`[U013 api-http] ${_label} -> ${response.status}`);
    expect(response.status).toBe(401);
  });

  it('rejects a structurally valid bearer token with no DB session at all (U014/SEC-01)', async () => {
    const token = validBearerToken();
    dbMocks.authSessionFindUnique.mockResolvedValueOnce(null);
    const response = await fetchClose('/api/metrics', { headers: { authorization: `Bearer ${token}` } });
    console.log(`[U014 api-http] no DB session -> ${response.status}`);
    expect(response.status).toBe(401);
  });

  it('rejects a still-valid bearer token once its session is revoked (U014/SEC-01)', async () => {
    const token = validBearerToken();
    dbMocks.authSessionFindUnique.mockResolvedValueOnce({
      id: 'index-test-jti-1',
      userId: 'operator-1',
      tenantId: 'tenant-1',
      companyId: 'company-1',
      projectId: 'project-1',
      issuedAt: new Date(),
      expiresAt: new Date(Date.now() + 900_000),
      revokedAt: new Date(),
      mfaVerifiedAt: null,
      mfaMethod: null,
    });
    const response = await fetchClose('/api/metrics', { headers: { authorization: `Bearer ${token}` } });
    console.log(`[U014 api-http] revoked session -> ${response.status}`);
    expect(response.status).toBe(401);
  });

  it('rejects a still-valid bearer token once its user is disabled — denied on the very next request (U014/SEC-01)', async () => {
    const token = validBearerToken();
    dbMocks.authSessionFindUnique.mockResolvedValueOnce({
      id: 'index-test-jti-1',
      userId: 'operator-1',
      tenantId: 'tenant-1',
      companyId: 'company-1',
      projectId: 'project-1',
      issuedAt: new Date(),
      expiresAt: new Date(Date.now() + 900_000),
      revokedAt: null,
      mfaVerifiedAt: null,
      mfaMethod: null,
    });
    dbMocks.userFindUnique.mockResolvedValueOnce({ id: 'operator-1', status: 'disabled', disabledAt: new Date() });
    const response = await fetchClose('/api/metrics', { headers: { authorization: `Bearer ${token}` } });
    console.log(`[U014 api-http] disabled user -> ${response.status}`);
    expect(response.status).toBe(401);
  });
});

describe('API production preflight', () => {
  it.each([['missing', undefined], ['blank', '   ']])('exits 78 before startup when SANGFOR_API_KEY is %s', (_label, key) => {
    // Given: an otherwise valid production child with a deterministic DB URL.
    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      TMPDIR: process.env.TMPDIR,
      LANG: 'C',
      NODE_ENV: 'production',
      HOST: '127.0.0.1',
      API_PORT: '0',
      AUTH_BYPASS_ENABLED: '0',
      API_KEY,
      FINANCE_API_KEY,
      SANGFOR_OPERATOR_PRINCIPAL_ID: 'u002-local-operator',
      DATABASE_URL: 'postgresql://u002:u002@127.0.0.1:1/u002_gate33',
      TSX_TSCONFIG_PATH: resolve(apiDirectory, 'tsconfig.json'),
    };
    if (key !== undefined) env.SANGFOR_API_KEY = key;

    // When: the real TypeScript entrypoint starts under Node 20.
    const result = spawnSync(process.execPath, [tsxCli, apiEntrypoint], { cwd: apiDirectory, env, encoding: 'utf8', timeout: 5_000 });

    // Then: configuration exits before listener output or any request-driven fetch.
    expect(result.status).toBe(78);
    expect(result.signal).toBeNull();
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('UNSAFE_AUTH_CONFIGURATION\n');
  });
});

describe('Outlook webhook public boundary', () => {
  it('rejects missing clientState', async () => {
    const response = await fetchClose('/webhooks/outlook', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value: [{ subscriptionId: 'sub-1' }] }),
    });
    expect(response.status).toBe(401);
  });

  it('rejects mismatched clientState with a stable error body', async () => {
    const response = await fetchClose('/webhooks/outlook', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value: [{ clientState: 'not-the-right-secret' }] }),
    });
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'invalid_client_state' });
  });

  it('accepts a notification whose clientState matches WEBHOOK_CLIENT_STATE', async () => {
    const response = await fetchClose('/webhooks/outlook', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value: [{ clientState: WEBHOOK_CLIENT_STATE }] }),
    });
    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ status: 'accepted' });
  });

  it('keeps the validation handshake public', async () => {
    const response = await fetchClose('/webhooks/outlook?validationToken=abc123');
    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe('abc123');
  });
});

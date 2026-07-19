import { createServer, type IncomingMessage } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createSessionToken, type SessionUser } from '@/lib/auth/session';
import { GET, POST } from './route';

type BridgeRequest = {
  readonly method: string;
  readonly path: string;
  readonly authorization: string | undefined;
  readonly body: string;
};

const ADMIN_USER: SessionUser = {
  id: 'mcp-route-admin',
  email: 'mcp-route-admin@example.com',
  role: 'admin',
  projectId: 'mcp-route-project',
  projectSlug: 'mcp-route-project',
};
const VIEWER_USER: SessionUser = { ...ADMIN_USER, id: 'mcp-route-viewer', role: 'viewer' };
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

const bridgeRequests: BridgeRequest[] = [];
let bridgeServer: ReturnType<typeof createServer> | undefined;
let bridgeMode: 'success' | 'disconnect' | 'whitelist' = 'success';

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

function authorizationHeaders(user: SessionUser = ADMIN_USER): Record<string, string> {
  return { authorization: `Bearer ${createSessionToken(user)}` };
}

function getRequest(user?: SessionUser): Request {
  return new Request('http://localhost/api/mcp/tools', { headers: authorizationHeaders(user) });
}

function postRequest(body: unknown, user: SessionUser = ADMIN_USER): Request {
  return new Request('http://localhost/api/mcp/tools', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authorizationHeaders(user) },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  vi.stubEnv('AUTH_BYPASS_ENABLED', '0');
  vi.stubEnv('JWT_SECRET', 'u002-mcp-route-test-secret');
  vi.stubEnv('SANGFOR_API_KEY', 'u002-web-to-bridge-key');
  bridgeServer = createServer(async (request, response) => {
    bridgeRequests.push({
      method: request.method ?? '',
      path: request.url ?? '',
      authorization: request.headers.authorization,
      body: await readBody(request),
    });
    if (bridgeMode === 'disconnect') {
      request.socket.destroy();
      return;
    }
    if (bridgeMode === 'whitelist') {
      response.writeHead(403, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'Tool not in safe whitelist: danger', allowedTools: ['sangfor.products'] }));
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(request.method === 'GET'
      ? JSON.stringify({ tools: [{ name: 'sangfor.products' }] })
      : JSON.stringify({ result: { ok: true } }));
  });
  await new Promise<void>((resolveListening, reject) => {
    bridgeServer?.once('error', reject);
    bridgeServer?.listen(0, '127.0.0.1', resolveListening);
  });
  const address = bridgeServer.address();
  if (address === null || typeof address === 'string') throw new TypeError('Expected TCP address');
  vi.stubEnv('WHELP99_MCP_HTTP_URL', `http://127.0.0.1:${address.port}`);
});

afterAll(async () => {
  if (bridgeServer) {
    await new Promise<void>((resolveClose, reject) => {
      bridgeServer?.close((error) => error ? reject(error) : resolveClose());
    });
  }
  vi.unstubAllEnvs();
});

beforeEach(() => {
  bridgeRequests.length = 0;
  bridgeMode = 'success';
});

describe('GET /api/mcp/tools through real infra HTTP', () => {
  it.each([
    ['missing session', undefined, 401],
    ['viewer session', VIEWER_USER, 403],
  ] as const)('rejects %s before the bridge', async (_label, user, status) => {
    // Given: a request without Web system-administrator authority.
    // When: GET crosses the production route.
    const request = user === undefined
      ? new Request('http://localhost/api/mcp/tools')
      : getRequest(user);
    const response = await GET(request);

    // Then: the route rejects locally with no bridge request.
    expect(response.status).toBe(status);
    expect(bridgeRequests).toHaveLength(0);
  });

  it('authenticates real infra GET with the server-owned bridge key', async () => {
    // Given: an authenticated Web administrator.
    // When: GET crosses the real unmocked infra client and local HTTP bridge.
    const response = await GET(getRequest());

    // Then: the bridge sees only the server Bearer credential.
    expect(response.status).toBe(200);
    expect(bridgeRequests).toEqual([{
      method: 'GET',
      path: '/tools',
      authorization: 'Bearer u002-web-to-bridge-key',
      body: '',
    }]);
  });

  it('returns a stable unreachable envelope when the bridge disconnects', async () => {
    bridgeMode = 'disconnect';
    const response = await GET(getRequest());

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({ tools: [], error: 'mcp_tools_unreachable' });
    expect(bridgeRequests).toHaveLength(1);
    expect(bridgeRequests[0]?.method).toBe('GET');
  });
});

describe('POST /api/mcp/tools through real infra HTTP', () => {
  it.each(CONFLICT_CASES)('rejects %s before the bridge', async (_label, argumentsValue) => {
    // Given: one exact identity key conflicts with the authenticated administrator.
    // When: POST crosses the production route.
    const response = await POST(postRequest({ name: 'sangfor.products', arguments: argumentsValue }));

    // Then: conflict is local and the bridge request count remains zero.
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'IDENTITY_CONFLICT' });
    expect(bridgeRequests).toHaveLength(0);
  });

  it('strips all matching recursive identities before real infra POST', async () => {
    // Given: all eight identity keys redundantly equal the Web administrator.
    const argumentsValue = {
      keep: 'value',
      approvedBy: ADMIN_USER.id,
      nested: {
        actorId: ADMIN_USER.id,
        requestedBy: ADMIN_USER.id,
        entries: [
          { requester: ADMIN_USER.id, approver: ADMIN_USER.id },
          { approverId: ADMIN_USER.id, approverPersonaId: ADMIN_USER.id, personaId: ADMIN_USER.id },
        ],
      },
    };

    // When: POST crosses the real unmocked infra client and local HTTP bridge.
    const response = await POST(postRequest({ name: 'sangfor.products', arguments: argumentsValue }));

    // Then: the bridge sees no root-domain identity and authenticates with its server key.
    expect(response.status).toBe(200);
    expect(bridgeRequests).toEqual([{
      method: 'POST',
      path: '/tools/call',
      authorization: 'Bearer u002-web-to-bridge-key',
      body: JSON.stringify({
        name: 'sangfor.products',
        arguments: { keep: 'value', nested: { entries: [{}, {}] } },
      }),
    }]);
  });

  it('rejects a missing tool name before the bridge', async () => {
    const response = await POST(postRequest({ arguments: {} }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'name is required' });
    expect(bridgeRequests).toHaveLength(0);
  });

  it('rejects invalid JSON before the bridge', async () => {
    const request = new Request('http://localhost/api/mcp/tools', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authorizationHeaders() },
      body: '{not json',
    });
    const response = await POST(request);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'invalid JSON body' });
    expect(bridgeRequests).toHaveLength(0);
  });

  it('forwards bridge whitelist failures with the server-owned credential', async () => {
    bridgeMode = 'whitelist';
    const response = await POST(postRequest({ name: 'danger' }));

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: 'Tool not in safe whitelist: danger',
      allowedTools: ['sangfor.products'],
    });
    expect(bridgeRequests).toHaveLength(1);
    expect(bridgeRequests[0]).toMatchObject({ method: 'POST', authorization: 'Bearer u002-web-to-bridge-key' });
  });
});

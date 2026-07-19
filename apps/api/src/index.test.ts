import { spawnSync } from 'node:child_process';
import type { Server } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const infraSpies = vi.hoisted(() => ({
  call: vi.fn(async () => ({ result: { ok: true } })),
  list: vi.fn(async () => [{ name: 'sangfor.products' }]),
}));

vi.mock('@sangfor/infra', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@sangfor/infra')>();
  return { ...actual, callMcpTool: infraSpies.call, listMcpTools: infraSpies.list };
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

let baseUrl = '';
let server: Server | undefined;

function apiKeyHeaders(key = API_KEY): Record<string, string> {
  return { 'x-api-key': key };
}

function postTool(argumentsValue: Readonly<Record<string, unknown>>, key = API_KEY): Promise<Response> {
  return fetch(`${baseUrl}/api/whelp99/tools/call`, {
    method: 'POST',
    headers: { ...apiKeyHeaders(key), 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'sangfor.products', arguments: argumentsValue }),
  });
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
  const { createApp } = await import('./index');
  server = createApp().listen(0, '127.0.0.1');
  await new Promise<void>((resolveListening) => server?.once('listening', resolveListening));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new TypeError('Expected TCP address');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  if (server) {
    await new Promise<void>((resolveClose, reject) => {
      server?.close((error) => error ? reject(error) : resolveClose());
    });
  }
  vi.unstubAllEnvs();
});

beforeEach(() => {
  infraSpies.call.mockClear();
  infraSpies.list.mockClear();
});

describe('root MCP transport authority', () => {
  it.each(['GET', 'POST'])('rejects missing API key before %s infra access', async (method) => {
    // Given: a request with no root authority credential.
    const request = method === 'GET'
      ? fetch(`${baseUrl}/api/whelp99/tools`)
      : fetch(`${baseUrl}/api/whelp99/tools/call`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });

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
      ? fetch(`${baseUrl}/api/whelp99/tools`, { headers: apiKeyHeaders(FINANCE_API_KEY) })
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
    const response = await fetch(`${baseUrl}/api/whelp99/tools`, { headers: apiKeyHeaders() });

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
    const response = await fetch(`${baseUrl}/webhooks/outlook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value: [{ subscriptionId: 'sub-1' }] }),
    });
    expect(response.status).toBe(401);
  });

  it('rejects mismatched clientState with a stable error body', async () => {
    const response = await fetch(`${baseUrl}/webhooks/outlook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value: [{ clientState: 'not-the-right-secret' }] }),
    });
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'invalid_client_state' });
  });

  it('accepts a notification whose clientState matches WEBHOOK_CLIENT_STATE', async () => {
    const response = await fetch(`${baseUrl}/webhooks/outlook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value: [{ clientState: WEBHOOK_CLIENT_STATE }] }),
    });
    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ status: 'accepted' });
  });

  it('keeps the validation handshake public', async () => {
    const response = await fetch(`${baseUrl}/webhooks/outlook?validationToken=abc123`);
    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe('abc123');
  });
});

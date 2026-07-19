import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInterface } from 'node:readline';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { join } from 'node:path';
import type { ProductChangePlan } from '../packages/sangfor-product-adapters/src/index.js';
import { createHttpBridgeServer } from '../apps/http-bridge/src/server.js';

const liveAdapterSpies = vi.hoisted(() => ({
  execute: vi.fn(async () => ({ ok: true })),
  read: vi.fn(async () => ({ status: 'ready' })),
}));

vi.mock('@sangfor/operator', () => ({
  executeLiveConsoleAction: liveAdapterSpies.execute,
  readLiveConsoleState: liveAdapterSpies.read,
}));

import { applyApprovedProductChange } from '../packages/sangfor-product-adapters/src/index.js';

const LIVE_PLAN: ProductChangePlan = {
  id: 'plan_containment',
  product: 'HCI_SCP',
  strategy: 'api-first',
  summary: 'Containment fixture',
  tasks: [
    {
      id: 'task_1',
      product: 'HCI_SCP',
      requirement: 'Apply a live HA policy change',
      capabilityId: 'ha_drs',
      menuPath: ['Reliability', 'HA/DRS'],
      apiEndpointCandidates: ['PUT /openstack/compute/v2/servers/{id}/metadata'],
      riskLevel: 'high',
      approvalRequired: true,
      rationale: 'Live mutation containment fixture',
    },
  ],
  rollbackPlan: ['Restore captured configuration'],
  validationPlan: ['Re-read HA state'],
  executionGates: ['Approval required'],
};

describe('Product mutation containment', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('keeps the JSON-RPC process alive across malformed and invalid requests', async () => {
    const serviceRoot = join(import.meta.dirname, '..');
    const child: ChildProcessWithoutNullStreams = spawn(process.execPath, [
      join(serviceRoot, 'node_modules/tsx/dist/cli.mjs'),
      join(serviceRoot, 'apps/mcp-server/src/index.ts'),
    ], {
      cwd: serviceRoot,
      env: {
        ...process.env,
        NODE_ENV: 'test',
        SANGFOR_API_KEY: 'engineer-test-key-000000000000',
        SANGFOR_OPERATOR_PRINCIPAL_ID: 'engineer-test-operator',
        WHELP99_ENFORCE_SAFE_TOOLS: 'true',
        TSX_TSCONFIG_PATH: join(serviceRoot, 'tsconfig.json'),
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const lines = createInterface({ input: child.stdout });
    const nextResponse = (): Promise<unknown> => new Promise((resolve, reject) => {
      const onLine = (line: string): void => {
        try {
          resolve(JSON.parse(line));
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      };
      lines.once('line', onLine);
      child.once('exit', () => reject(new Error('MCP child exited before response')));
    });
    try {
      const malformed = nextResponse();
      child.stdin.write('{not-json}\n');
      await expect(malformed).resolves.toMatchObject({ error: { code: -32700, message: 'Parse error' } });

      const invalid = nextResponse();
      child.stdin.write('{"jsonrpc":"2.0","id":1}\n');
      await expect(invalid).resolves.toMatchObject({ id: 1, error: { code: -32600, message: 'Invalid Request' } });

      const initialized = nextResponse();
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { _meta: { apiKey: 'engineer-test-key-000000000000' } } })}\n`);
      await expect(initialized).resolves.toMatchObject({ id: 2, result: { protocolVersion: '2025-06-18' } });
      expect(child.exitCode).toBeNull();
    } finally {
      lines.close();
      child.kill('SIGTERM');
      await new Promise<void>(resolve => child.once('exit', () => resolve()));
    }
  });

  it('invokes zero live adapters when product mutation is requested with every legacy live gate enabled', async () => {
    // Given: all legacy live flags, approval fields, and a live session are present.
    vi.stubEnv('SANGFOR_ALLOW_REAL_EXECUTION', 'true');
    vi.stubEnv('SANGFOR_ALLOW_PRODUCTION_EXECUTION', 'true');

    // When: the public barrel apply entrypoint receives a production change.
    const result = await applyApprovedProductChange({
      plan: LIVE_PLAN,
      environment: 'production',
      sessionId: 'session_live',
      approval: {
        approvedBy: 'caller-controlled-identity',
        approvalToken: 'legacy-token',
        changeTicketId: 'CHG-1',
        rollbackPlanId: 'RB-1',
      },
    });

    // Then: containment denies before any live adapter can be reached.
    expect(result).toMatchObject({
      ok: false,
      mutationPerformed: false,
      reason: 'MUTATION_CONTAINED_BY_U002',
    });
    expect(liveAdapterSpies.read).toHaveBeenCalledTimes(0);
    expect(liveAdapterSpies.execute).toHaveBeenCalledTimes(0);
  });

  it('returns 403 with zero production bridge calls for a server-owned non-operator context', async () => {
    // Given: the real bridge server receives a server-owned viewer context at its auth seam.
    const requestMcp = vi.fn(async () => ({ jsonrpc: '2.0', result: { ok: true } }));
    const server = createHttpBridgeServer({
      authenticateRequest: () => ({
        principalId: 'engineer-test-viewer',
        role: 'viewer',
        source: 'api_key',
      }),
      requestMcp,
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (address === null || typeof address === 'string') throw new TypeError('Expected TCP address');

    try {
      // When: the caller requests a tool through the production HTTP route.
      const response = await fetch(`http://127.0.0.1:${address.port}/tools/call`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'sangfor.products', arguments: {} }),
      });

      // Then: the production guard returns exact 403 before the MCP mutation seam.
      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual({ error: 'FORBIDDEN' });
      expect(requestMcp).toHaveBeenCalledTimes(0);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
  });

  it('strips recursive identities and injects only the fixed service actor at the bridge child seam', async () => {
    // Given: the production bridge authenticates a fixed service operator and exposes an MCP child spy.
    const servicePrincipal = 'engineer-fixed-service-operator';
    const requestMcp = vi.fn(async () => ({ jsonrpc: '2.0', result: { ok: true } }));
    const server = createHttpBridgeServer({
      authenticateRequest: () => ({
        principalId: servicePrincipal,
        role: 'operator',
        source: 'api_key',
      }),
      requestMcp,
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (address === null || typeof address === 'string') throw new TypeError('Expected TCP address');

    try {
      // When: all eight matching identities cross objects and arrays in a direct bridge request.
      const response = await fetch(`http://127.0.0.1:${address.port}/tools/call`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'sangfor.products',
          arguments: {
            keep: 'value',
            approvedBy: servicePrincipal,
            nested: {
              actorId: servicePrincipal,
              requestedBy: servicePrincipal,
              values: [
                { requester: servicePrincipal, approver: servicePrincipal },
                { approverId: servicePrincipal, approverPersonaId: servicePrincipal, personaId: servicePrincipal },
              ],
            },
          },
        }),
      });

      // Then: the child sees one top-level server actor and no other identity occurrence.
      expect(response.status).toBe(200);
      expect(requestMcp).toHaveBeenCalledWith('tools/call', {
        name: 'sangfor.products',
        arguments: {
          keep: 'value',
          nested: { values: [{}, {}] },
          actorId: servicePrincipal,
        },
      });
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
  });

  it('invalidates readiness and performs one health-triggered child restart after an actual child exit', async () => {
    const childScript = [
      "const readline = require('node:readline');",
      "const rl = readline.createInterface({ input: process.stdin });",
      "rl.on('line', line => { const message = JSON.parse(line); if (message.method === 'initialize') process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: '2025-06-18' } }) + '\\n'); if (message.method === 'tools/list') process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { tools: [{ name: 'sangfor.products' }] } }) + '\\n'); if (message.method === 'tools/call') process.stderr.write('CALL_RECEIVED\\n'); });",
    ].join('');
    const children: ChildProcessWithoutNullStreams[] = [];
    const server = createHttpBridgeServer({
      authenticateRequest: () => ({ principalId: 'engineer-fixed-service-operator', role: 'operator', source: 'api_key' }),
      spawnChild: () => {
        const child = spawn(process.execPath, ['-e', childScript], { stdio: ['pipe', 'pipe', 'pipe'] });
        children.push(child);
        return child;
      },
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (address === null || typeof address === 'string') throw new TypeError('Expected TCP address');
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const health = async (): Promise<Response> => fetch(`${baseUrl}/health`);
    const waitUntilReady = async (): Promise<Response> => {
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        const response = await health();
        if (response.status === 200) return response;
        await new Promise<void>(resolve => setImmediate(resolve));
      }
      throw new Error('bridge did not recover readiness');
    };

    try {
      expect((await health()).status).toBe(503);
      expect((await waitUntilReady()).status).toBe(200);
      expect(children).toHaveLength(1);

      const exited = new Promise<void>(resolve => children[0]?.once('exit', () => resolve()));
      children[0]?.kill('SIGTERM');
      await exited;
      const probes = await Promise.all([health(), health(), health(), health()]);
      expect(probes.map(response => response.status)).toEqual([503, 503, 503, 503]);
      expect((await waitUntilReady()).status).toBe(200);
      expect(children).toHaveLength(2);

      const pendingCall = fetch(`${baseUrl}/tools/call`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'sangfor.products', arguments: {} }),
      });
      await new Promise<void>(resolve => {
        const child = children[1];
        if (!child) throw new Error('restarted child missing');
        child.stderr.on('data', (chunk: Buffer) => {
          if (String(chunk).includes('CALL_RECEIVED')) resolve();
        });
      });
      const restartedExit = new Promise<void>(resolve => children[1]?.once('exit', () => resolve()));
      children[1]?.kill('SIGTERM');
      await restartedExit;
      const rejected = await pendingCall;
      expect(rejected.status).toBe(500);
      await expect(rejected.json()).resolves.toEqual({ error: 'MCP child process exited' });
      expect((await health()).status).toBe(503);
    } finally {
      for (const child of children) child.kill('SIGTERM');
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  }, 15_000);
});

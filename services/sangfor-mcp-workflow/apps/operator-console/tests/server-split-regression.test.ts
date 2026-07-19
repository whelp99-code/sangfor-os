import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bootstrapMcpClient } from '../src/bootstrap/mcp-bootstrap.js';
import { createOperatorApp, installOperatorBootstrap } from '../src/server.js';
import { createOperatorConsoleContext } from '../src/server-context.js';
import type { OperatorConsoleContext } from '../src/server-context.js';
import {
  McpStdioClient,
  ToolRegistry,
  type McpSpawnOptions,
} from '@sangfor/workflow-engine';

const VALID_KEY = 'workflow-test-key-0000000000000000';
const PRINCIPAL_ID = 'workflow-test-operator';
const EXPECTED_CHILD_KEY = '2fdfae425dab46654fe30fbd51d799837b5f6ab13d623418f4af1bb565ab60e7';
const WORKFLOW_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const ENGINEER_ROOT = resolve(WORKFLOW_ROOT, '..', 'sangfor-engineer-mcp');
const ENGINEER_ENTRY = join(ENGINEER_ROOT, 'apps/mcp-server/src/index.ts');
const ENGINEER_TSX = join(ENGINEER_ROOT, 'node_modules/tsx/dist/cli.mjs');
const ENGINEER_TSCONFIG = join(ENGINEER_ROOT, 'tsconfig.json');

function createActualEngineerClient(
  childKey: string,
  requestApiKey: string,
): McpStdioClient {
  return new McpStdioClient(ENGINEER_ENTRY, {
    cwd: ENGINEER_ROOT,
    command: 'node',
    args: [ENGINEER_TSX, ENGINEER_ENTRY],
    envMode: 'replace',
    env: {
      PATH: `${dirname(process.execPath)}:/usr/bin:/bin`,
      HOME: process.env.HOME ?? WORKFLOW_ROOT,
      TMPDIR: process.env.TMPDIR ?? '/tmp',
      LANG: 'C',
      LC_ALL: 'C',
      NODE_ENV: 'production',
      HOST: '127.0.0.1',
      AUTH_BYPASS_ENABLED: '0',
      SANGFOR_DB_ENABLED: '0',
      SANGFOR_OCR_DIR: join(WORKFLOW_ROOT, 'outputs', 'captcha-ocr'),
      SANGFOR_API_KEY: childKey,
      SANGFOR_OPERATOR_PRINCIPAL_ID: PRINCIPAL_ID,
      WHELP99_ENFORCE_SAFE_TOOLS: 'true',
      TSX_TSCONFIG_PATH: ENGINEER_TSCONFIG,
      NO_PROXY: '127.0.0.1,localhost',
      HTTP_PROXY: '',
      HTTPS_PROXY: '',
      ALL_PROXY: '',
    },
    requestApiKey,
    requestTimeoutMs: 10_000,
  });
}

async function getApp(
  app: express.Express,
  path: string,
  apiKey?: string,
) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new TypeError('Expected an ephemeral TCP listener');
  }
  try {
    const headers = new Headers();
    if (apiKey) headers.set('X-API-Key', apiKey);
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, { headers });
    const body = response.headers.get('content-type')?.includes('application/json')
      ? await response.json()
      : await response.text();
    return { status: response.status, body };
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

async function postApp(
  app: express.Express,
  path: string,
  body: Readonly<Record<string, unknown>>,
  apiKey: string,
) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new TypeError('Expected an ephemeral TCP listener');
  }
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

const EXPECTED_ROUTES = [
  'get /api/system/health',
  'get /api/config',
  'get /api/dashboard/stats',
  'get /api/workflows',
  'get /api/workflows/:id',
  'post /api/workflows/generate',
  'post /api/workflows/from-template',
  'post /api/workflows/:id/approve',
  'post /api/workflows/:id/reject',
  'post /api/workflows/:id/execute',
  'get /api/workflows/:id/logs',
  'post /api/workflows/upload-excel',
  'get /api/templates',
  'get /api/templates/search',
  'post /api/compliance/track',
  'get /api/compliance/trend',
  'post /api/compliance/roadmap',
  'post /api/compliance/proposal',
  'post /api/manual/ask',
  'post /api/manual/menu-path',
  'post /api/device/capture-menu',
  'post /api/device/compare',
  'post /api/guide/generate',
  'post /api/vendors/compare',
  'post /api/vendors/report',
  'post /api/learning/run',
  'get /api/learning/schedules',
  'post /api/learning/schedules',
  'post /api/learning/schedules/:id/run',
  'post /api/access/request',
  'post /api/access/submit',
  'get /api/access/requests',
  'get /api/snapshots/:product',
  'post /api/plan',
  'get /api/approvals',
  'post /api/approvals/:id/approve',
  'post /api/approvals/:id/reject',
  'post /api/execute/:planId',
  'get /api/evidence/:executionId',
  'post /api/breakglass/request',
  'post /api/breakglass/:id/approve',
  'get /api/breakglass/active',
  'post /api/incidents/detect',
  'post /api/incidents/:id/remediation',
  'post /api/remediation/:id/execute',
  'get /api/events',
] as const;

describe('operator server split regression', () => {
  let context: OperatorConsoleContext;

  beforeEach(() => {
    process.env.SANGFOR_API_KEY = VALID_KEY;
    process.env.SANGFOR_OPERATOR_PRINCIPAL_ID = PRINCIPAL_ID;
    context = createOperatorConsoleContext();
  });

  afterEach(async () => {
    await context.dispose();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    delete process.env.SANGFOR_API_KEY;
    delete process.env.SANGFOR_OPERATOR_PRINCIPAL_ID;
  });

  it('registers every pre-split method and path exactly once in its owned registrar', () => {
    // Given: the three route registrar source files.
    const sources = [
      readFileSync(new URL('../src/routes/system-routes.ts', import.meta.url), 'utf8'),
      readFileSync(new URL('../src/routes/workflow-routes.ts', import.meta.url), 'utf8'),
      readFileSync(new URL('../src/routes/auto-ops-routes.ts', import.meta.url), 'utf8'),
    ].join('\n');

    // When: literal Express method/path registrations are enumerated.
    const registrations = Array.from(sources.matchAll(/app\.(get|post)\(['"]([^'"]+)['"]/g))
      .map((match) => `${match[1]} ${match[2]}`)
      .sort();

    // Then: the exact baseline inventory exists once, with no duplicate or extra route.
    expect(registrations).toEqual([...EXPECTED_ROUTES].sort());
    expect(new Set(registrations).size).toBe(registrations.length);
  });

  it('keeps only the exact minimal liveness route public', async () => {
    // Given: an operator app with a ready local bootstrap.
    const connected = new McpStdioClient('ready-fixture');
    vi.spyOn(connected, 'isConnected').mockReturnValue(true);
    context.runtime.mcpClient = connected;
    context.runtime.ready = true;
    const app = createOperatorApp(context);

    // When: public liveness, metadata, API, and static surfaces are requested without credentials.
    const health = await getApp(app, '/api/system/health');
    const config = await getApp(app, '/api/config');
    const workflow = await getApp(app, '/api/workflows');
    const staticRoot = await getApp(app, '/');

    // Then: only liveness is public, with its exact body.
    expect(health.status).toBe(200);
    expect(health.body).toEqual({ status: 'ok' });
    expect(config.status).toBe(401);
    expect(workflow.status).toBe(401);
    expect(staticRoot.status).toBe(401);
  });

  it('returns 503 once, starts server-owned bootstrap, then returns exact ready 200', async () => {
    // Given: an operator app whose required local context has not bootstrapped.
    context.runtime.ready = false;
    let bootstrapCalls = 0;
    context.runtime.requestBootstrap = () => {
      bootstrapCalls += 1;
      queueMicrotask(() => {
        const connected = new McpStdioClient('ready-fixture');
        vi.spyOn(connected, 'isConnected').mockReturnValue(true);
        context.runtime.mcpClient = connected;
        context.runtime.ready = true;
      });
    };
    const app = createOperatorApp(context);

    // When: liveness is observed before and after the asynchronous bootstrap.
    const unavailable = await getApp(app, '/api/system/health');
    const ready = await getApp(app, '/api/system/health');

    // Then: the first response is deterministically unavailable and bootstrap runs once.
    expect(unavailable.status).toBe(503);
    expect(unavailable.body).toEqual({ status: 'unavailable' });
    expect(ready.status).toBe(200);
    expect(ready.body).toEqual({ status: 'ok' });
    expect(bootstrapCalls).toBe(1);
  });

  it('keeps production readiness false and retries after null, disconnected, and rejected bootstrap results', async () => {
    // Given: required production bootstrap successively returns null, disconnected, and rejected results.
    vi.stubEnv('NODE_ENV', 'production');
    const disconnected = new McpStdioClient('not-started');
    const outcomes: Array<McpStdioClient | null | Error> = [
      null,
      disconnected,
      new Error('injected bootstrap failure'),
      null,
    ];
    let bootstrapCalls = 0;
    const bootstrap = vi.fn(async () => {
      const outcome = outcomes[bootstrapCalls++];
      if (outcome instanceof Error) throw outcome;
      return outcome ?? null;
    });
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    installOperatorBootstrap(context, {
      bootstrap,
      isShuttingDown: () => false,
    });
    const app = createOperatorApp(context);

    // When: liveness schedules each retry after the prior failed bootstrap settles.
    for (let expectedCalls = 1; expectedCalls <= outcomes.length; expectedCalls += 1) {
      const health = await getApp(app, '/api/system/health');
      expect(health).toEqual({ status: 503, body: { status: 'unavailable' } });
      await vi.waitFor(() => expect(bootstrap).toHaveBeenCalledTimes(expectedCalls));
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(context.runtime.ready).toBe(false);
      expect(context.runtime.mcpClient).toBeNull();
    }

    // Then: every failure mode is fail-closed and leaves the bootstrap retryable.
    expect(bootstrapCalls).toBe(outcomes.length);
  });

  it('does not reopen a disconnected bootstrap retry until asynchronous child cleanup settles', async () => {
    // Given: a disconnected child whose stop completion is controlled without a timer.
    const disconnected = new McpStdioClient('not-started');
    let releaseStop: (() => void) | undefined;
    const stopSettled = new Promise<void>((resolve) => { releaseStop = resolve; });
    const stop = vi.spyOn(disconnected, 'stop').mockReturnValue(stopSettled);
    const bootstrap = vi.fn()
      .mockResolvedValueOnce(disconnected)
      .mockResolvedValue(null);
    installOperatorBootstrap(context, { bootstrap, isShuttingDown: () => false });

    // When: a second request arrives while the first child's stop is still pending.
    context.runtime.requestBootstrap();
    await vi.waitFor(() => expect(stop).toHaveBeenCalledTimes(1));
    context.runtime.requestBootstrap();
    await new Promise<void>((resolve) => setImmediate(resolve));

    // Then: retry remains closed until stop resolves, and only then can it reopen.
    expect(bootstrap).toHaveBeenCalledTimes(1);
    releaseStop?.();
    await stopSettled;
    await new Promise<void>((resolve) => setImmediate(resolve));
    context.runtime.requestBootstrap();
    await vi.waitFor(() => expect(bootstrap).toHaveBeenCalledTimes(2));
  });

  it('invalidates successful readiness on child disconnect and permits one clean restart', async () => {
    // Given: two real local stdio children that answer initialize and remain attached to stdin.
    const fixtureSource = [
      "const readline = require('node:readline');",
      "const input = readline.createInterface({ input: process.stdin });",
      "input.on('line', (line) => {",
      "  const request = JSON.parse(line);",
      "  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: {} }) + '\\n');",
      '});',
    ].join('\n');
    const clients = [0, 1].map(() => new McpStdioClient('fixture', {
      command: process.execPath,
      args: ['-e', fixtureSource],
      envMode: 'replace',
      env: { PATH: `${dirname(process.execPath)}:/usr/bin:/bin` },
      requestTimeoutMs: 5_000,
    }));
    for (const client of clients) await client.start();
    let nextClient = 0;
    const bootstrap = vi.fn(async () => clients[nextClient++] ?? null);
    installOperatorBootstrap(context, { bootstrap, isShuttingDown: () => false });

    try {
      // When: a healthy child disconnects, then the next health-triggered bootstrap starts.
      context.runtime.requestBootstrap();
      await vi.waitFor(() => expect(context.runtime.ready).toBe(true));
      await clients[0].stop();
      await vi.waitFor(() => expect(context.runtime.ready).toBe(false));
      context.runtime.requestBootstrap();
      await vi.waitFor(() => expect(context.runtime.ready).toBe(true));

      // Then: state is invalidated before one retry and the replacement is the only live child.
      expect(bootstrap).toHaveBeenCalledTimes(2);
      expect(context.runtime.mcpClient).toBe(clients[1]);
      expect(clients[0].isConnected()).toBe(false);
      expect(clients[1].isConnected()).toBe(true);
    } finally {
      await Promise.all(clients.map(client => client.stop()));
    }

    expect(clients.every(client => !client.isConnected())).toBe(true);
  });

  it('keeps disposal pending until in-flight bootstrap and shutdown child cleanup settle', async () => {
    // Given: bootstrap and the returned child's stop each have independent completion controls.
    let shuttingDown = false;
    let releaseBootstrap: ((client: McpStdioClient | null) => void) | undefined;
    const bootstrapPending = new Promise<McpStdioClient | null>((resolve) => {
      releaseBootstrap = resolve;
    });
    const bootstrap = vi.fn(() => bootstrapPending);
    const connected = new McpStdioClient('not-started');
    let releaseStop: (() => void) | undefined;
    const stopSettled = new Promise<void>((resolve) => { releaseStop = resolve; });
    let markStopStarted: (() => void) | undefined;
    const stopStarted = new Promise<void>((resolve) => { markStopStarted = resolve; });
    const stop = vi.spyOn(connected, 'stop').mockImplementation(() => {
      markStopStarted?.();
      return stopSettled;
    });
    installOperatorBootstrap(context, { bootstrap, isShuttingDown: () => shuttingDown });

    // When: disposal begins after bootstrap starts but before it returns the child.
    context.runtime.requestBootstrap();
    shuttingDown = true;
    let disposalSettled = false;
    const disposal = context.dispose().finally(() => { disposalSettled = true; });

    try {
      // Then: disposal stays pending across both deferred lifecycle boundaries and stops once.
      await Promise.resolve();
      expect(disposalSettled).toBe(false);
      releaseBootstrap?.(connected);
      await stopStarted;
      expect(disposalSettled).toBe(false);
      releaseStop?.();
      await disposal;
      expect(disposalSettled).toBe(true);
      expect(stop).toHaveBeenCalledTimes(1);
      expect(context.runtime.mcpClient).toBeNull();
      expect(context.runtime.ready).toBe(false);
    } finally {
      releaseBootstrap?.(connected);
      releaseStop?.();
      await disposal;
    }
  });

  it('bootstraps an actual engineer child with the fixed domain-separated launch contract', async () => {
    // Given: fixed workflow and legacy MCP credentials plus an unrelated parent sentinel.
    const rawWorkflowKey = 'workflow-raw-key-that-must-not-cross-the-child-boundary';
    const legacyMcpKey = 'legacy-mcp-key-that-must-not-cross-the-child-boundary';
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('SANGFOR_API_KEY', rawWorkflowKey);
    vi.stubEnv('MCP_API_KEY', legacyMcpKey);
    vi.stubEnv('U002_PARENT_ENV_MUST_NOT_CROSS', 'parent-env-sentinel');
    vi.stubEnv('SANGFOR_OPERATOR_PRINCIPAL_ID', PRINCIPAL_ID);
    vi.stubEnv('WHELP99_ENFORCE_SAFE_TOOLS', 'true');
    vi.stubEnv('AUTH_BYPASS_ENABLED', '0');
    vi.stubEnv('SANGFOR_MCP_CWD', ENGINEER_ROOT);

    const rawKeyClient = createActualEngineerClient(EXPECTED_CHILD_KEY, rawWorkflowKey);
    const legacyKeyClient = createActualEngineerClient(EXPECTED_CHILD_KEY, legacyMcpKey);
    const registry = new ToolRegistry();
    let connectedClient: McpStdioClient | null = null;
    const launchCapture: {
      current?: { serverPath: string; options: McpSpawnOptions };
    } = {};
    const emitted: string[] = [];
    for (const method of ['debug', 'info', 'warn', 'error'] as const) {
      vi.spyOn(console, method).mockImplementation((...values: unknown[]) => {
        emitted.push(values.map(String).join(' '));
      });
    }

    try {
      // When: both parent credentials are rejected and bootstrap launches the real child.
      const rejectionMessages: string[] = [];
      for (const client of [rawKeyClient, legacyKeyClient]) {
        try {
          await client.start();
          rejectionMessages.push('unexpected success');
        } catch (error) {
          rejectionMessages.push(error instanceof Error ? error.message : String(error));
        }
      }
      connectedClient = await bootstrapMcpClient(
        registry,
        WORKFLOW_ROOT,
        (serverPath, options) => {
          launchCapture.current = { serverPath, options };
          return new McpStdioClient(serverPath, options);
        },
      );
      const products = await connectedClient?.callTool('sangfor.products', {});

      // Then: the fixed key reaches only child auth boundaries and tools/call authenticates.
      expect(rejectionMessages).toEqual([
        expect.stringContaining('UNAUTHENTICATED'),
        expect.stringContaining('UNAUTHENTICATED'),
      ]);
      expect(connectedClient).not.toBeNull();
      expect(connectedClient?.isConnected()).toBe(true);
      expect(registry.listTools().length).toBeGreaterThan(0);
      expect(registry.hasTool('sangfor.products')).toBe(true);
      expect(registry.hasTool('search_manuals')).toBe(true);
      expect(products).toEqual({
        products: expect.arrayContaining([
          expect.objectContaining({ code: 'HCI_SCP' }),
          expect.objectContaining({ code: 'IAG' }),
        ]),
      });

      const observed = launchCapture.current;
      expect(observed).toBeDefined();
      if (!observed) throw new TypeError('Expected bootstrap launch capture');
      expect(observed.serverPath).toBe(ENGINEER_ENTRY);
      expect(observed.options.command).toBe(process.execPath);
      expect(isAbsolute(observed.options.command ?? '')).toBe(true);
      expect(observed.options.args?.[0]).toMatch(/\/tsx\/dist\/cli\.mjs$/);
      expect(isAbsolute(observed.options.args?.[0] ?? '')).toBe(true);
      expect(observed.options.args?.[1]).toBe(ENGINEER_ENTRY);
      expect(observed.options.envMode).toBe('replace');
      expect(observed.options.requestApiKey).toBe(EXPECTED_CHILD_KEY);
      expect(observed.options.env?.SANGFOR_API_KEY).toBe(EXPECTED_CHILD_KEY);
      expect(Object.keys(observed.options.env ?? {}).sort()).toEqual([
        'ALL_PROXY',
        'AUTH_BYPASS_ENABLED',
        'HOME',
        'HTTPS_PROXY',
        'HTTP_PROXY',
        'LANG',
        'LC_ALL',
        'NODE_ENV',
        'NO_PROXY',
        'PATH',
        'SANGFOR_API_KEY',
        'SANGFOR_DB_ENABLED',
        'SANGFOR_OCR_DIR',
        'SANGFOR_OPERATOR_PRINCIPAL_ID',
        'TMPDIR',
        'TSX_TSCONFIG_PATH',
        'WHELP99_ENFORCE_SAFE_TOOLS',
      ].sort());

      const capturedBoundaries = JSON.stringify({
        launch: observed,
        emitted,
        rejectionMessages,
      });
      expect(capturedBoundaries).not.toContain(rawWorkflowKey);
      expect(capturedBoundaries).not.toContain(legacyMcpKey);
      expect(capturedBoundaries).not.toContain('parent-env-sentinel');
    } finally {
      await rawKeyClient.stop();
      await legacyKeyClient.stop();
      await connectedClient?.stop();
    }

    expect(rawKeyClient.isConnected()).toBe(false);
    expect(legacyKeyClient.isConnected()).toBe(false);
    expect(connectedClient?.isConnected()).toBe(false);
  });

  it('routes both production owners through the sole domain-separated client factory', () => {
    const productionCallers = [
      readFileSync(new URL('../src/bootstrap/mcp-bootstrap.ts', import.meta.url), 'utf8'),
      readFileSync(new URL('../../mcp-server/src/tool-context.ts', import.meta.url), 'utf8'),
    ];

    for (const source of productionCallers) {
      expect(source).toContain('createDomainSeparatedEngineerMcpClient');
      expect(source).not.toContain('new McpStdioClient');
    }
  });

  it('rejects an identity conflict before the matching route handler', async () => {
    // Given: an authenticated request for an unknown approval.
    const app = createOperatorApp(context);

    // When: the body tries to replace the server principal.
    const response = await postApp(
      app,
      '/api/approvals/not-present/approve',
      { approvedBy: 'caller-controlled' },
      VALID_KEY,
    );

    // Then: identity validation wins before the route can return its normal 404.
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'IDENTITY_CONFLICT' });
  });

  it('keeps the composition entrypoint within the 250-line ceiling', () => {
    // Given / When: the composition module is counted by physical lines, a stricter upper bound here.
    const serverLines = readFileSync(new URL('../src/server.ts', import.meta.url), 'utf8').split('\n').length;

    // Then: it stays within the card ceiling.
    expect(serverLines).toBeLessThanOrEqual(250);
  });
});

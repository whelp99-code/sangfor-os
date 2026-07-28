import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import {
  IdentityConflictError,
  MutationDeniedError,
  UnsafeAuthConfigurationError,
  assertSafeWorkflowConfiguration,
  authenticateWorkflowApiKey,
  denyWorkflowMutation,
  enforceServerIdentity,
  requireOperatorPrincipal,
} from '../../../packages/shared/src/mutation-policy.js';
import {
  apiKeyAuth,
  identityConflictGuard,
  requireOperatorContext,
} from '../src/middleware/auth.js';

const VALID_KEY = 'workflow-test-key-0000000000000000';
const PRINCIPAL_ID = 'workflow-test-operator';
const WORKFLOW_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const WORKFLOW_MCP_ENTRY = join(WORKFLOW_ROOT, 'apps/mcp-server/src/index.ts');
const OPERATOR_ENTRY = join(WORKFLOW_ROOT, 'apps/operator-console/src/server.ts');
const WORKFLOW_TSX = join(WORKFLOW_ROOT, 'node_modules/tsx/dist/cli.mjs');
const WORKFLOW_TSCONFIG = join(WORKFLOW_ROOT, 'tsconfig.json');

const PREFLIGHT_FIELDS = [
  ['MCP_API_KEY', 'direct-mcp-key-0000000000000000'],
  ['SANGFOR_API_KEY', VALID_KEY],
  ['SANGFOR_OPERATOR_PRINCIPAL_ID', PRINCIPAL_ID],
  ['WHELP99_ENFORCE_SAFE_TOOLS', 'true'],
] as const;

const PREFLIGHT_CASES = PREFLIGHT_FIELDS.flatMap(([field, validValue]) => [
  [`missing ${field}`, field, undefined],
  [`blank ${field}`, field, '  '],
] as const);

const ENTRYPOINTS = [
  ['operator console', OPERATOR_ENTRY],
  ['direct MCP server', WORKFLOW_MCP_ENTRY],
] as const;

async function postJson(
  app: express.Express,
  path: string,
  options: { readonly apiKey?: string; readonly body: Readonly<Record<string, unknown>> },
) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new TypeError('Expected an ephemeral TCP listener');
  }
  try {
    const headers = new Headers({ 'Content-Type': 'application/json' });
    if (options.apiKey) headers.set('X-API-Key', options.apiKey);
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(options.body),
    });
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

describe('workflow auth containment', () => {
  it.each(ENTRYPOINTS.flatMap(([entrypointName, entrypoint]) => PREFLIGHT_CASES.map((testCase) => [
    entrypointName,
    entrypoint,
    ...testCase,
  ] as const)))('exits 78 before %s startup for %s', (_entrypointName, entrypoint, _caseName, field, value) => {
      // Given: a fresh cwd and one independently missing or blank preflight field.
      const freshCwd = mkdtempSync(join(tmpdir(), 'u002-workflow-preflight-'));
      const environment: NodeJS.ProcessEnv = {
        PATH: `${dirname(process.execPath)}:/usr/bin:/bin`,
        HOME: freshCwd,
        TMPDIR: freshCwd,
        LANG: 'C',
        LC_ALL: 'C',
        NODE_ENV: 'production',
        TSX_TSCONFIG_PATH: WORKFLOW_TSCONFIG,
        MCP_API_KEY: 'direct-mcp-key-0000000000000000',
        SANGFOR_API_KEY: VALID_KEY,
        SANGFOR_OPERATOR_PRINCIPAL_ID: PRINCIPAL_ID,
        WHELP99_ENFORCE_SAFE_TOOLS: 'true',
      };
      delete environment[field];
      if (value !== undefined) environment[field] = value;

      try {
        // When: the actual entrypoint starts with that exact environment.
        const result = spawnSync(process.execPath, [WORKFLOW_TSX, entrypoint], {
          cwd: freshCwd,
          env: environment,
          encoding: 'utf8',
          timeout: 10_000,
        });

        // Then: startup fails at the preflight boundary without binding or starting tools.
        expect(result.status).toBe(78);
        expect(result.signal).toBeNull();
        expect(result.stdout).toBe('');
        expect(result.stderr).toBe('UNSAFE_AUTH_CONFIGURATION\n');
      } finally {
        rmSync(freshCwd, { recursive: true, force: true });
      }
    },
  );

  it('authenticates a constant-time API key into a server-owned operator context', () => {
    // Given: a server key and principal that are not supplied by the request body.
    const configuration = { apiKey: VALID_KEY, principalId: PRINCIPAL_ID };

    // When: the presented credential is validated.
    const context = authenticateWorkflowApiKey(VALID_KEY, configuration);

    // Then: only the fixed server identity is returned.
    expect(context).toEqual({
      principalId: PRINCIPAL_ID,
      role: 'operator',
      source: 'api_key',
    });
    expect(authenticateWorkflowApiKey('wrong-length', configuration)).toBeNull();
    expect(authenticateWorkflowApiKey(`x${VALID_KEY.slice(1)}`, configuration)).toBeNull();
  });

  it.each([
    ['auth bypass', { AUTH_BYPASS_ENABLED: '1', SANGFOR_API_KEY: VALID_KEY, SANGFOR_OPERATOR_PRINCIPAL_ID: PRINCIPAL_ID }],
    ['api-key bypass', { API_KEY_BYPASS_ENABLED: '1', SANGFOR_API_KEY: VALID_KEY, SANGFOR_OPERATOR_PRINCIPAL_ID: PRINCIPAL_ID }],
    ['safe tools disabled', { WHELP99_ENFORCE_SAFE_TOOLS: 'false', SANGFOR_API_KEY: VALID_KEY, SANGFOR_OPERATOR_PRINCIPAL_ID: PRINCIPAL_ID }],
    ['missing service key', { SANGFOR_OPERATOR_PRINCIPAL_ID: PRINCIPAL_ID }],
    ['missing server principal', { SANGFOR_API_KEY: VALID_KEY }],
  ])('fails production preflight with exit 78 before registration for %s', (_caseName, environment) => {
    // Given: an unsafe production configuration.
    const productionEnvironment = { NODE_ENV: 'production', ...environment };

    // When / Then: preflight fails with the process-level containment code.
    expect(() => assertSafeWorkflowConfiguration(productionEnvironment, 'SANGFOR_API_KEY'))
      .toThrowError(UnsafeAuthConfigurationError);
    try {
      assertSafeWorkflowConfiguration(productionEnvironment, 'SANGFOR_API_KEY');
    } catch (error) {
      expect(error).toBeInstanceOf(UnsafeAuthConfigurationError);
      if (error instanceof UnsafeAuthConfigurationError) {
        expect(error.code).toBe('UNSAFE_AUTH_CONFIGURATION');
        expect(error.exitCode).toBe(78);
      }
    }
  });

  it('rejects caller identity conflicts and always returns the server principal', () => {
    // Given: an authenticated server context.
    const context = { principalId: PRINCIPAL_ID, role: 'operator', source: 'api_key' } as const;

    // When / Then: redundant identity is accepted, while a different identity is rejected.
    expect(enforceServerIdentity(context, { approvedBy: PRINCIPAL_ID })).toBe(PRINCIPAL_ID);
    expect(enforceServerIdentity(context, {})).toBe(PRINCIPAL_ID);
    expect(() => enforceServerIdentity(context, { actorId: 'caller-controlled' }))
      .toThrowError(IdentityConflictError);
    expect(() => requireOperatorPrincipal('caller-controlled'))
      .toThrowError('UNAUTHENTICATED');
  });

  it('denies side effects by default', () => {
    // Given / When / Then: no credential or live flag can opt a mutation into U002.
    expect(() => denyWorkflowMutation('live_device_execution'))
      .toThrowError(MutationDeniedError);
  });

  it('maps missing, invalid, non-operator, and conflicting HTTP identity before a handler', async () => {
    // Given: a protected route whose terminal handler is observable.
    process.env.SANGFOR_API_KEY = VALID_KEY;
    process.env.SANGFOR_OPERATOR_PRINCIPAL_ID = PRINCIPAL_ID;
    const handler = vi.fn((_request: Request, response: Response) => response.json({ status: 'handled' }));
    const app = express();
    app.use(express.json());
    app.post('/protected', apiKeyAuth, requireOperatorContext, identityConflictGuard, handler);
    const viewerApp = express();
    viewerApp.use(express.json());
    viewerApp.post(
      '/protected',
      (_request, response, next) => {
        response.locals.authContext = {
          principalId: 'workflow-test-viewer',
          role: 'viewer',
          source: 'api_key',
        };
        next();
      },
      apiKeyAuth,
      requireOperatorContext,
      identityConflictGuard,
      handler,
    );

    // When: each invalid authority class calls the route.
    const missing = await postJson(app, '/protected', { body: {} });
    const invalid = await postJson(app, '/protected', { apiKey: 'invalid', body: {} });
    const forbidden = await postJson(viewerApp, '/protected', { body: {} });
    const conflict = await postJson(app, '/protected', {
      apiKey: VALID_KEY,
      body: { nested: [{ approvedBy: 'caller-controlled' }] },
    });

    // Then: all are rejected and no terminal handler is reached.
    expect(missing.status).toBe(401);
    expect(invalid.status).toBe(401);
    expect(forbidden.status).toBe(403);
    expect(conflict.status).toBe(400);
    expect(conflict.body).toEqual({ error: 'IDENTITY_CONFLICT' });
    expect(handler).toHaveBeenCalledTimes(0);

    delete process.env.SANGFOR_API_KEY;
    delete process.env.SANGFOR_OPERATOR_PRINCIPAL_ID;
  });

  it('strips matching recursive identities before the HTTP handler', async () => {
    // Given: an authenticated route whose handler returns the sanitized body.
    process.env.SANGFOR_API_KEY = VALID_KEY;
    process.env.SANGFOR_OPERATOR_PRINCIPAL_ID = PRINCIPAL_ID;
    const app = express();
    app.use(express.json());
    app.post(
      '/protected',
      apiKeyAuth,
      requireOperatorContext,
      identityConflictGuard,
      (request, response) => response.json(request.body),
    );

    try {
      // When: all eight redundant identities appear across objects and arrays.
      const result = await postJson(app, '/protected', {
        apiKey: VALID_KEY,
        body: {
          keep: 'value',
          approvedBy: PRINCIPAL_ID,
          nested: {
            actorId: PRINCIPAL_ID,
            requestedBy: PRINCIPAL_ID,
            values: [
              { requester: PRINCIPAL_ID, approver: PRINCIPAL_ID },
              { approverId: PRINCIPAL_ID, approverPersonaId: PRINCIPAL_ID, personaId: PRINCIPAL_ID },
            ],
          },
        },
      });

      // Then: no caller identity survives into the handler.
      expect(result.status).toBe(200);
      expect(result.body).toEqual({ keep: 'value', nested: { values: [{}, {}] } });
    } finally {
      delete process.env.SANGFOR_API_KEY;
      delete process.env.SANGFOR_OPERATOR_PRINCIPAL_ID;
    }
  });
});

import express from 'express';
import { createServer } from 'node:http';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INTERNAL_PRINCIPAL_KEYRING_VERSION, parseInternalPrincipalConfig } from '@sangfor/config';
import { issueInternalPrincipal, verifyInternalPrincipal } from '@sangfor/auth';

import { createInternalPrincipalMiddleware } from './internal-principal';

const D = 1_700_000_000;

function timestamp(seconds: number): string {
  return new Date(seconds * 1_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function config() {
  const ring = (kid: string, byte: number) => JSON.stringify({
    version: INTERNAL_PRINCIPAL_KEYRING_VERSION,
    keys: [{ kid, state: 'active', secretBase64Url: Buffer.alloc(32, byte).toString('base64url'), activatedAt: timestamp(D - 10), demotedAt: null, verificationCutoff: null, retiredAt: null }],
  });
  return parseInternalPrincipalConfig({
    INTERNAL_PRINCIPAL_TTL_SECONDS: '60', INTERNAL_PRINCIPAL_CLOCK_SKEW_SECONDS: '5', INTERNAL_PRINCIPAL_ROTATION_OWNER: 'security-auth',
    INTERNAL_PRINCIPAL_FINANCE_ACTIVE_KID: 'finance', INTERNAL_PRINCIPAL_FINANCE_KEYRING_JSON: ring('finance', 1),
    INTERNAL_PRINCIPAL_SCHEDULER_ACTIVE_KID: 'scheduler', INTERNAL_PRINCIPAL_SCHEDULER_KEYRING_JSON: ring('scheduler', 2),
    INTERNAL_PRINCIPAL_WORKFLOW_ACTIVE_KID: 'workflow', INTERNAL_PRINCIPAL_WORKFLOW_KEYRING_JSON: ring('workflow', 3),
    INTERNAL_PRINCIPAL_ENGINEER_ACTIVE_KID: 'engineer', INTERNAL_PRINCIPAL_ENGINEER_KEYRING_JSON: ring('engineer', 4),
  }, D);
}

const protocolConfig = config();
let server: ReturnType<typeof createServer> | undefined;
let baseUrl = '';
let replayClaims = 0;

function financeEnvelope(body: string): string {
  return issueInternalPrincipal({
    profile: 'FINANCE', subjectType: 'human_delegation', subjectId: 'human-1', sessionId: 'session-1',
    tenantId: 'tenant-1', companyId: 'company-1', projectId: 'project-1', businessRole: 'finance_manager', capabilities: ['finance.read'],
    method: 'POST', path: '/api/cfo/invoices', query: '', body, idempotencyKey: `idem-${replayClaims}`,
  }, protocolConfig, { now: D, randomBytes: () => Buffer.alloc(16, replayClaims + 1) });
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/cfo', createInternalPrincipalMiddleware({
    profile: 'FINANCE', config: protocolConfig, now: () => D + 1,
    claimReplay: async () => { replayClaims += 1; },
  }));
  app.post('/api/cfo/invoices', (req, res) => res.json({
    actor: req.authContext?.userId, session: req.authContext?.sessionId, role: req.authContext?.businessRole,
    tenant: req.authContext?.tenantId, ignoredBodyActor: (req.body as { actorId?: string }).actorId ?? null,
  }));
  server = createServer(app);
  await new Promise<void>((resolve, reject) => server!.listen(0, '127.0.0.1', (error?: Error) => error ? reject(error) : resolve()));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('ephemeral listener unavailable');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server?.close((error) => error ? reject(error) : resolve()));
});

describe('finance internal-principal middleware', () => {
  it('rejects a present forged envelope before any API-key fallback can assign authority', async () => {
    const response = await fetch(`${baseUrl}/api/cfo/invoices`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': 'manager-key', 'x-sangfor-internal-principal': 'forged.unsigned.token' }, body: '{}',
    });
    expect(response.status).toBe(401);
  });

  it('sets the authenticated human exclusively from the signed envelope, never request JSON or x-user headers', async () => {
    const body = JSON.stringify({ actorId: 'body-ceo', businessRole: 'ceo' });
    const envelope = financeEnvelope(body);
    expect(verifyInternalPrincipal(envelope, { profile: 'FINANCE', method: 'POST', path: '/api/cfo/invoices', query: '', body }, protocolConfig, D + 1).subjectId).toBe('human-1');
    const response = await fetch(`${baseUrl}/api/cfo/invoices`, {
      method: 'POST', headers: {
        'content-type': 'application/json', 'x-sangfor-internal-principal': envelope,
        'x-user-id': 'header-ceo', 'x-business-role': 'ceo',
      }, body,
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ actor: 'human-1', session: 'session-1', role: 'finance_manager', tenant: 'tenant-1', ignoredBodyActor: 'body-ceo' });
  });
});

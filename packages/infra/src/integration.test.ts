import { describe, expect, it, vi } from 'vitest';

import {
  getIntegrationTarget,
  listIntegrationTargets,
  probeIntegrationTarget,
  probeAllIntegrationTargets,
} from './integration';

function mockResponse(body: string, init: { ok: boolean; status: number }): Response {
  return {
    ok: init.ok,
    status: init.status,
    text: () => Promise.resolve(body),
  } as unknown as Response;
}

describe('getIntegrationTarget', () => {
  it('resolves a known target with an upstream health URL', () => {
    const target = getIntegrationTarget('whelp99-code-sangfor-engineer-mcp');
    expect(target.id).toBe('whelp99-code-sangfor-engineer-mcp');
    expect(target.status).toBe('unknown');
    expect(target.upstream).toMatch(/\/health$/);
  });

  it('returns an inert target for an unknown name', () => {
    const target = getIntegrationTarget('does-not-exist');
    expect(target.status).toBe('unknown');
    expect(target.upstream).toBe('');
  });

  it('registers all expected MCP service targets', () => {
    expect(listIntegrationTargets()).toEqual(
      expect.arrayContaining([
        'whelp99-code-sangfor-engineer-mcp',
        'sangfor-mcp-workflow',
        'sangfor-engineer-operator-console',
        'sangfor-mock-console',
      ]),
    );
  });
});

describe('probeIntegrationTarget', () => {
  it('reports healthy on a 2xx response and records latency', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(mockResponse('{"status":"ok"}', { ok: true, status: 200 }));
    const result = await probeIntegrationTarget(getIntegrationTarget('sangfor-mcp-workflow'), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.status).toBe('healthy');
    expect(result.details).toContain('ok');
    expect(typeof result.latencyMs).toBe('number');
  });

  it('reports degraded when the service responds non-2xx', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(mockResponse('down', { ok: false, status: 503 }));
    const result = await probeIntegrationTarget(getIntegrationTarget('sangfor-mcp-workflow'), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.status).toBe('degraded');
  });

  it('reports unreachable when fetch rejects', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const result = await probeIntegrationTarget(getIntegrationTarget('sangfor-mcp-workflow'), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.status).toBe('unreachable');
    expect(result.details).toContain('ECONNREFUSED');
  });

  it('reports unknown when the target has no upstream', async () => {
    const fetchImpl = vi.fn();
    const result = await probeIntegrationTarget(getIntegrationTarget('does-not-exist'), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.status).toBe('unknown');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('probeAllIntegrationTargets', () => {
  it('probes every registered target', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(mockResponse('ok', { ok: true, status: 200 }));
    const results = await probeAllIntegrationTargets({ fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(results).toHaveLength(listIntegrationTargets().length);
    expect(results.every((r) => r.status === 'healthy')).toBe(true);
  });
});

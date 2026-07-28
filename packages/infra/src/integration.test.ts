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

  it('honors env URL overrides for every target (U006 surface/fixtures)', () => {
    const prev = {
      WHELP99_MCP_HTTP_URL: process.env.WHELP99_MCP_HTTP_URL,
      SANGFOR_MCP_URL: process.env.SANGFOR_MCP_URL,
      WHELP99_OPERATOR_CONSOLE_URL: process.env.WHELP99_OPERATOR_CONSOLE_URL,
      SANGFOR_MOCK_CONSOLE_URL: process.env.SANGFOR_MOCK_CONSOLE_URL,
    };
    try {
      process.env.WHELP99_MCP_HTTP_URL = 'http://127.0.0.1:45999';
      process.env.SANGFOR_MCP_URL = 'http://127.0.0.1:45999';
      process.env.WHELP99_OPERATOR_CONSOLE_URL = 'http://127.0.0.1:45999';
      process.env.SANGFOR_MOCK_CONSOLE_URL = 'http://127.0.0.1:45999';
      expect(getIntegrationTarget('whelp99-code-sangfor-engineer-mcp').upstream).toBe(
        'http://127.0.0.1:45999/health',
      );
      expect(getIntegrationTarget('sangfor-mcp-workflow').upstream).toBe(
        'http://127.0.0.1:45999/api/system/health',
      );
      expect(getIntegrationTarget('sangfor-engineer-operator-console').upstream).toBe(
        'http://127.0.0.1:45999/api/health/store',
      );
      expect(getIntegrationTarget('sangfor-mock-console').upstream).toBe(
        'http://127.0.0.1:45999/',
      );
    } finally {
      for (const [key, value] of Object.entries(prev)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
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

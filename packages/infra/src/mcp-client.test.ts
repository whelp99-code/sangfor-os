import { describe, expect, it, vi } from 'vitest';

import { callMcpTool, listMcpTools } from './mcp-client';

function jsonResponse(body: unknown, init: { ok: boolean; status: number } = { ok: true, status: 200 }): Response {
  return {
    ok: init.ok,
    status: init.status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

describe('listMcpTools', () => {
  it('returns the tools array from the bridge', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ tools: [{ name: 'sangfor.products' }] }),
    );
    const tools = await listMcpTools({ fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(tools).toEqual([{ name: 'sangfor.products' }]);
    expect(fetchImpl).toHaveBeenCalledWith(expect.stringMatching(/\/tools$/), expect.any(Object));
  });

  it('throws when the bridge returns an error envelope', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ error: 'mcp down', tools: [] }, { ok: false, status: 502 }),
    );
    await expect(
      listMcpTools({ fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toThrow('mcp down');
  });
});

describe('callMcpTool', () => {
  it('posts name + arguments and returns the result envelope', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ result: { ok: true } }));
    const out = await callMcpTool(
      'sangfor.products',
      { product: 'HCI' },
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    expect(out).toEqual({ result: { ok: true } });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toMatch(/\/tools\/call$/);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ name: 'sangfor.products', arguments: { product: 'HCI' } });
  });

  it('passes through a whitelist rejection envelope', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ error: 'Tool not in safe whitelist: danger', allowedTools: ['sangfor.products'] }, { ok: false, status: 403 }),
    );
    const out = await callMcpTool('danger', {}, { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(out.error).toContain('whitelist');
    expect(out.allowedTools).toEqual(['sangfor.products']);
  });

  it('rejects an empty tool name without calling fetch', async () => {
    const fetchImpl = vi.fn();
    await expect(
      callMcpTool('', {}, { fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toThrow('tool name is required');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

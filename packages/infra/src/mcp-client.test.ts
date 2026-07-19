import { createServer, type IncomingMessage } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { callMcpTool, listMcpTools } from './mcp-client';

type ObservedRequest = {
  readonly method: string;
  readonly path: string;
  readonly authorization: string | undefined;
  readonly body: string;
};

function jsonResponse(body: unknown, init: { readonly ok: boolean; readonly status: number }): Response {
  return {
    ok: init.ok,
    status: init.status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function startBridge(): Promise<{
  readonly baseUrl: string;
  readonly requests: ObservedRequest[];
  readonly close: () => Promise<void>;
}> {
  const requests: ObservedRequest[] = [];
  const server = createServer(async (request, response) => {
    requests.push({
      method: request.method ?? '',
      path: request.url ?? '',
      authorization: request.headers.authorization,
      body: await readBody(request),
    });
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(request.method === 'GET'
      ? JSON.stringify({ tools: [{ name: 'sangfor.products' }] })
      : JSON.stringify({ result: { ok: true } }));
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new TypeError('Expected a TCP address');
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    }),
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('MCP bridge server credential', () => {
  it.each(['missing', 'blank'])('fails before GET fetch when SANGFOR_API_KEY is %s', async (state) => {
    // Given: no usable server-owned bridge credential and an observable fetch seam.
    if (state === 'missing') delete process.env.SANGFOR_API_KEY;
    else vi.stubEnv('SANGFOR_API_KEY', '   ');
    const fetchImpl = vi.fn<typeof fetch>();

    // When / Then: configuration failure is stable and fetch stays untouched.
    await expect(listMcpTools({ fetchImpl })).rejects.toMatchObject({
      name: 'McpClientConfigurationError',
      code: 'UNSAFE_AUTH_CONFIGURATION',
      message: 'UNSAFE_AUTH_CONFIGURATION',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(0);
  });

  it.each(['missing', 'blank'])('fails before POST fetch when SANGFOR_API_KEY is %s', async (state) => {
    // Given: no usable server-owned bridge credential and an observable fetch seam.
    if (state === 'missing') delete process.env.SANGFOR_API_KEY;
    else vi.stubEnv('SANGFOR_API_KEY', '   ');
    const fetchImpl = vi.fn<typeof fetch>();

    // When / Then: configuration failure is stable and fetch stays untouched.
    await expect(callMcpTool('sangfor.products', {}, { fetchImpl })).rejects.toMatchObject({
      name: 'McpClientConfigurationError',
      code: 'UNSAFE_AUTH_CONFIGURATION',
      message: 'UNSAFE_AUTH_CONFIGURATION',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(0);
  });
});

describe('listMcpTools', () => {
  it('throws the bridge error when GET returns a non-OK error envelope', async () => {
    // Given: a configured client and a bridge error response.
    vi.stubEnv('SANGFOR_API_KEY', 'u002-infra-server-key');
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ error: 'mcp down', tools: [] }, { ok: false, status: 502 }),
    );

    // When / Then: the stable bridge error is thrown and GET is attempted once.
    await expect(listMcpTools({ fetchImpl })).rejects.toThrow('mcp down');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('sends the server-owned Bearer credential on GET', async () => {
    // Given: a real local HTTP bridge and a server-only key.
    vi.stubEnv('SANGFOR_API_KEY', 'u002-infra-server-key');
    const bridge = await startBridge();
    try {
      // When: the real client lists tools through the HTTP seam.
      const tools = await listMcpTools({ baseUrl: bridge.baseUrl });

      // Then: the response is parsed and the wire request carries the Bearer key.
      expect(tools).toEqual([{ name: 'sangfor.products' }]);
      expect(bridge.requests).toEqual([{
        method: 'GET',
        path: '/tools',
        authorization: 'Bearer u002-infra-server-key',
        body: '',
      }]);
    } finally {
      await bridge.close();
    }
  });
});

describe('callMcpTool', () => {
  it('passes through a whitelist rejection envelope from POST', async () => {
    // Given: a configured client and a safe-tool whitelist rejection.
    vi.stubEnv('SANGFOR_API_KEY', 'u002-infra-server-key');
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(
        { error: 'Tool not in safe whitelist: danger', allowedTools: ['sangfor.products'] },
        { ok: false, status: 403 },
      ),
    );

    // When: the rejected tool is invoked.
    const result = await callMcpTool('danger', {}, { fetchImpl });

    // Then: the bridge envelope and status are observable without throwing.
    expect(result).toEqual({ error: 'Tool not in safe whitelist: danger', allowedTools: ['sangfor.products'] });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringMatching(/\/tools\/call$/),
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ name: 'danger', arguments: {} }) }),
    );
  });

  it('sends the server-owned Bearer credential and arguments on POST', async () => {
    // Given: a real local HTTP bridge and a server-only key.
    vi.stubEnv('SANGFOR_API_KEY', 'u002-infra-server-key');
    const bridge = await startBridge();
    try {
      // When: the real client invokes a tool through the HTTP seam.
      const result = await callMcpTool(
        'sangfor.products',
        { product: 'HCI' },
        { baseUrl: bridge.baseUrl },
      );

      // Then: the wire body is exact and the same Bearer key authenticates POST.
      expect(result).toEqual({ result: { ok: true } });
      expect(bridge.requests).toEqual([{
        method: 'POST',
        path: '/tools/call',
        authorization: 'Bearer u002-infra-server-key',
        body: JSON.stringify({ name: 'sangfor.products', arguments: { product: 'HCI' } }),
      }]);
    } finally {
      await bridge.close();
    }
  });

  it('rejects an empty tool name before reading configuration or calling fetch', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    await expect(callMcpTool('', {}, { fetchImpl })).rejects.toThrow('tool name is required');
    expect(fetchImpl).toHaveBeenCalledTimes(0);
  });
});

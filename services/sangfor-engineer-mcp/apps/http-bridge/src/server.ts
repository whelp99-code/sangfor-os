import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import http from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import {
  authenticateApiKey,
  authorizeHttpContext,
  enforceProductionAuthPreflight,
  extractHttpApiKey,
  findCallerIdentityConflict,
  withServerActor,
  type AuthContext,
} from '../../../packages/shared/src/mutation-policy.js';

const MODULE_PATH = fileURLToPath(import.meta.url);
const CURRENT_DIRECTORY = dirname(MODULE_PATH);
const REPO_ROOT = join(CURRENT_DIRECTORY, '..', '..', '..');
const MCP_ENTRY = join(REPO_ROOT, 'apps/mcp-server/src/index.ts');
const HOST = process.env.HOST ?? '127.0.0.1';
const PORT = Number(process.env.PORT ?? process.env.WHELP99_HTTP_BRIDGE_PORT ?? 3600);

export const SAFE_TOOL_WHITELIST = new Set([
  'sangfor.products',
  'sangfor.search_manuals',
  'sangfor.get_manual_section',
  'sangfor.rag_search',
  'sangfor.rag_index_summary',
  'sangfor.store_health',
]);

type JsonRpcResponse = Readonly<{
  jsonrpc: string;
  id?: string | number;
  result?: unknown;
  error?: Readonly<{ code: number; message: string }>;
}>;

type PendingRequest = Readonly<{
  resolve: (value: JsonRpcResponse) => void;
  reject: (error: Error) => void;
}>;

class McpBridgeError extends Error {}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isJsonRpcResponse(value: unknown): value is JsonRpcResponse {
  return isRecord(value) && value.jsonrpc === '2.0';
}

class McpBridgeRuntime {
  private mcpChild: ChildProcessWithoutNullStreams | null = null;
  private requestId = 0;
  private ready = false;
  private bootstrapPromise: Promise<void> | null = null;
  private childStartPromise: Promise<void> | null = null;
  private readonly pending = new Map<number, PendingRequest>();
  private ipcArm: Readonly<{ nonce: string; release: Promise<void>; resolve: () => void; reject: (error: Error) => void }> | null = null;
  private readonly ipcMessageHandler = (message: unknown): void => {
    if (!isRecord(message) || message.protocol !== 'u002-containment-ipc/v1' || message.boundary !== 'bridge-to-child') return;
    const nonce = typeof message.nonce === 'string' ? message.nonce : undefined;
    if (!nonce || typeof process.send !== 'function' || !process.connected) return;
    if (message.type === 'arm' && this.ipcArm === null) {
      let resolve = (): void => undefined;
      let reject = (_error: Error): void => undefined;
      const release = new Promise<void>((releaseResolve, releaseReject) => { resolve = releaseResolve; reject = releaseReject; });
      this.ipcArm = { nonce, release, resolve, reject };
      void this.sendIpc({ protocol: 'u002-containment-ipc/v1', type: 'armed', boundary: 'bridge-to-child', nonce }).catch((error: unknown) => {
        this.ipcArm?.reject(error instanceof Error ? error : new McpBridgeError(String(error)));
      });
      return;
    }
    if (message.type === 'release' && this.ipcArm?.nonce === nonce) this.ipcArm.resolve();
  };
  private readonly ipcDisconnectHandler = (): void => {
    this.ipcArm?.reject(new McpBridgeError('U002_IPC_DISCONNECTED'));
    this.ipcArm = null;
    process.off('message', this.ipcMessageHandler);
    process.off('disconnect', this.ipcDisconnectHandler);
  };

  private sendIpc(message: Readonly<Record<string, unknown>>): Promise<void> {
    return new Promise((resolve, reject) => {
      if (typeof process.send !== 'function' || !process.connected) {
        reject(new McpBridgeError('U002_IPC_DISCONNECTED'));
        return;
      }
      process.send(message, error => error ? reject(error) : resolve());
    });
  }

  constructor(private readonly spawnChild: () => ChildProcessWithoutNullStreams = () => spawn('pnpm', ['exec', 'tsx', MCP_ENTRY], {
    cwd: REPO_ROOT,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env },
  })) {
    if (typeof process.send === 'function' && process.connected) {
      process.on('message', this.ipcMessageHandler);
      process.once('disconnect', this.ipcDisconnectHandler);
    }
  }

  private startMcpChild(): ChildProcessWithoutNullStreams {
  const child = this.spawnChild();
  const lines = createInterface({ input: child.stdout });
  lines.on('line', line => {
    if (!line.trim()) return;
    try {
      const message: unknown = JSON.parse(line);
      if (!isJsonRpcResponse(message) || message.id === undefined) return;
      const id = Number(message.id);
      const handler = this.pending.get(id);
      if (!handler) return;
      this.pending.delete(id);
      handler.resolve(message);
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
    }
  });
  child.stderr.on('data', chunk => process.stderr.write(`[mcp] ${String(chunk)}`));
  child.stdin.on('error', () => {
    const error = new McpBridgeError('MCP child process exited');
    for (const handler of this.pending.values()) handler.reject(error);
    this.pending.clear();
  });
  child.on('exit', code => {
    process.stderr.write(`[mcp] exited with code ${String(code)}\n`);
    if (this.mcpChild !== child) return;
    this.mcpChild = null;
    this.ready = false;
    for (const handler of this.pending.values()) handler.reject(new McpBridgeError('MCP child process exited'));
    this.pending.clear();
  });
  return child;
}

private withMcpCredential(params: unknown): Readonly<Record<string, unknown>> {
  const input = isRecord(params) ? params : {};
  return { ...input, _meta: { apiKey: process.env.SANGFOR_API_KEY ?? '' } };
}

private async emitBridgeCapture(method: string, params: unknown): Promise<Readonly<{ nonce: string }> | null> {
  if (method !== 'tools/call' || this.ipcArm === null || typeof process.send !== 'function' || !process.connected || !isRecord(params)) return null;
  const name = typeof params.name === 'string' ? params.name : undefined;
  if (!name) return null;
  const args = isRecord(params.arguments) ? params.arguments : {};
  const secretValues = [process.env.SANGFOR_API_KEY, process.env.MCP_API_KEY].filter((value): value is string => Boolean(value));
  const redact = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(redact);
    if (typeof value === 'string' && secretValues.includes(value)) return '[REDACTED]';
    if (!isRecord(value)) return value;
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !/(?:api[-_]?key|authorization|password|secret|token)/i.test(key))
      .map(([key, value]) => [key, redact(value)]));
  };
  const arm = this.ipcArm;
  const sent = this.sendIpc({ protocol: 'u002-containment-ipc/v1', type: 'capture', boundary: 'bridge-to-child', nonce: arm.nonce, toolName: name, arguments: redact(args) });
  await Promise.all([sent, arm.release]);
  return arm;
}

private completeBridgeCapture(arm: Readonly<{ nonce: string }> | null, outcome: 'returned' | 'threw'): void {
  if (!arm || this.ipcArm?.nonce !== arm.nonce || typeof process.send !== 'function' || !process.connected) return;
  this.ipcArm = null;
  process.off('message', this.ipcMessageHandler);
  process.off('disconnect', this.ipcDisconnectHandler);
  void this.sendIpc({ protocol: 'u002-containment-ipc/v1', type: 'complete', boundary: 'bridge-to-child', nonce: arm.nonce, outcome }).catch((error: unknown) => {
    if (error instanceof Error) process.stderr.write(`[bridge-ipc] ${error.message}\n`);
  });
}

private async sendMcpRequest(method: string, params?: unknown): Promise<JsonRpcResponse> {
  const child = this.mcpChild;
  if (!child) return Promise.reject(new McpBridgeError('MCP child process is not running'));
  const id = ++this.requestId;
  const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params: this.withMcpCredential(params) });
  const capture = await this.emitBridgeCapture(method, params);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      this.pending.delete(id);
      this.completeBridgeCapture(capture, 'threw');
      reject(new McpBridgeError(`MCP request timeout: ${method}`));
    }, 30_000);
    this.pending.set(id, {
      resolve: message => { clearTimeout(timeout); this.completeBridgeCapture(capture, 'returned'); resolve(message); },
      reject: error => { clearTimeout(timeout); this.completeBridgeCapture(capture, 'threw'); reject(error); },
    });
    child.stdin.write(`${payload}\n`);
  });
}

private async ensureChild(): Promise<void> {
  if (this.mcpChild) return;
  if (this.childStartPromise) return this.childStartPromise;
  const start = (async (): Promise<void> => {
    this.mcpChild = this.startMcpChild();
    try {
      const initialized = await this.sendMcpRequest('initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'http-bridge', version: '0.1.0' },
      });
      if (initialized.error) throw new McpBridgeError(initialized.error.message);
    } catch (error) {
      if (this.mcpChild) this.mcpChild.kill();
      throw error;
    }
  })();
  this.childStartPromise = start;
  try {
    await start;
  } finally {
    if (this.childStartPromise === start) this.childStartPromise = null;
  }
}

async request(method: string, params?: unknown): Promise<JsonRpcResponse> {
  await this.ensureChild();
  return this.sendMcpRequest(method, params);
}

requestBootstrap(): void {
  if (this.ready || this.bootstrapPromise) return;
  const bootstrap = (async (): Promise<void> => {
    const response = await this.request('tools/list');
    const result = isRecord(response.result) ? response.result : {};
    if (response.error || !Array.isArray(result.tools) || result.tools.length === 0) {
      throw new McpBridgeError(response.error?.message ?? 'MCP tool registry is empty');
    }
    this.ready = true;
  })().catch((error: unknown) => {
    this.ready = false;
    process.stderr.write(`[bridge-bootstrap] ${error instanceof Error ? error.message : String(error)}\n`);
  });
  this.bootstrapPromise = bootstrap;
  void bootstrap.finally(() => {
    if (this.bootstrapPromise === bootstrap) this.bootstrapPromise = null;
  });
}

isReady(): boolean {
  return this.ready;
}

stop(): void {
  this.ready = false;
  this.bootstrapPromise = null;
  this.childStartPromise = null;
  this.mcpChild?.kill();
  this.mcpChild = null;
  for (const handler of this.pending.values()) handler.reject(new McpBridgeError('MCP bridge stopped'));
  this.pending.clear();
}
}

async function readJsonBody(req: http.IncomingMessage): Promise<Readonly<Record<string, unknown>>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw.trim()) return {};
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed)) throw new McpBridgeError('JSON body must be an object');
  return parsed;
}

function json(res: http.ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function requireOperator(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  authenticateRequest: (request: http.IncomingMessage) => unknown,
): AuthContext | undefined {
  const decision = authorizeHttpContext(authenticateRequest(req));
  if (!decision.allowed) {
    json(res, { error: decision.error }, decision.status);
    return undefined;
  }
  return decision.context;
}

type HttpBridgeDependencies = Readonly<{
  authenticateRequest?: (request: http.IncomingMessage) => unknown;
  requestMcp?: (method: string, params?: unknown) => Promise<JsonRpcResponse>;
  requestBootstrap?: () => void;
  spawnChild?: () => ChildProcessWithoutNullStreams;
}>;

export function createHttpBridgeServer(dependencies: HttpBridgeDependencies = {}): http.Server {
  const runtime = new McpBridgeRuntime(dependencies.spawnChild);
  const authenticateRequest = dependencies.authenticateRequest
    ?? ((request: http.IncomingMessage) => authenticateApiKey(extractHttpApiKey(request.headers)));
  const requestMcp = dependencies.requestMcp ?? runtime.request.bind(runtime);
  const requestBootstrap = dependencies.requestBootstrap ?? runtime.requestBootstrap.bind(runtime);

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${HOST}:${PORT}`);
    if (req.method === 'GET' && url.pathname === '/health') {
      if (runtime.isReady()) return json(res, { status: 'ok' });
      requestBootstrap();
      return json(res, { status: 'unavailable' }, 503);
    }

    const context = requireOperator(req, res, authenticateRequest);
    if (!context) return;

    try {
      if (req.method === 'GET' && url.pathname === '/tools') {
        const response = await requestMcp('tools/list');
        if (response.error) return json(res, { error: response.error.message }, 502);
        const result = isRecord(response.result) ? response.result : {};
        return json(res, { tools: Array.isArray(result.tools) ? result.tools : [] });
      }
      if (req.method === 'POST' && url.pathname === '/tools/call') {
        const body = await readJsonBody(req);
        const conflict = findCallerIdentityConflict(body, context);
        if (conflict) return json(res, { error: 'IDENTITY_CONFLICT' }, 400);
        const name = typeof body.name === 'string' ? body.name : '';
        if (!name) return json(res, { error: 'name is required' }, 400);
        if (!SAFE_TOOL_WHITELIST.has(name)) return json(res, { error: 'FORBIDDEN' }, 403);
        const rawArguments = body.arguments ?? body.args ?? {};
        const response = await requestMcp('tools/call', { name, arguments: withServerActor(rawArguments, context) });
        if (response.error) return json(res, { error: response.error.message }, 502);
        return json(res, { result: response.result });
      }
      return json(res, { error: 'Not found' }, 404);
    } catch (error) {
      return json(res, { error: error instanceof Error ? error.message : String(error) }, 500);
    }
  });
  server.once('close', () => runtime.stop());
  return server;
}

export function startHttpBridgeServer(): http.Server {
  enforceProductionAuthPreflight();
  const server = createHttpBridgeServer();
  server.listen(PORT, HOST, () => process.stdout.write(`whelp99 MCP HTTP bridge listening on http://${HOST}:${PORT}\n`));
  const shutdown = (): void => {
    server.close(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === MODULE_PATH) startHttpBridgeServer();

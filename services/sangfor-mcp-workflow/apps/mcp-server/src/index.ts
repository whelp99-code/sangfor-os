import readline from 'node:readline';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  UnsafeAuthConfigurationError,
  assertWorkflowMcpPreflight,
  authenticateWorkflowApiKey,
} from '../../../packages/shared/src/mutation-policy.js';
import type { JsonRpcRequest, WorkflowToolContext } from './tool-types.js';

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readCredential(request: JsonRpcRequest): string | undefined {
  if (!isRecord(request.params)) return undefined;
  if (typeof request.params.authKey === 'string') return request.params.authKey;
  const metadata = request.params._meta;
  if (!isRecord(metadata)) return undefined;
  if (typeof metadata.authKey === 'string') return metadata.authKey;
  return typeof metadata.apiKey === 'string' ? metadata.apiKey : undefined;
}

function parseRequest(line: string): JsonRpcRequest {
  const parsed: unknown = JSON.parse(line);
  if (!isRecord(parsed) || parsed.jsonrpc !== '2.0' || typeof parsed.method !== 'string') {
    throw new TypeError('INVALID_REQUEST');
  }
  const id = typeof parsed.id === 'string' || typeof parsed.id === 'number' || parsed.id === null
    ? parsed.id
    : null;
  return parsed.params === undefined
    ? { jsonrpc: '2.0', id, method: parsed.method }
    : { jsonrpc: '2.0', id, method: parsed.method, params: parsed.params };
}

async function closeContext(context: WorkflowToolContext): Promise<void> {
  context.breakGlassPolicy.dispose();
  await context.runtime.mcpClient.stop();
  context.runtime.ready = false;
}

/**
 * MCP tool-context init failure policy (D3 fail-closed gate).
 * Soft-fail only when containerLiveness is true (SANGFOR_DOCKER_LIVENESS=1);
 * production/default rethrows so the process exits.
 * Exported for unit tests that assert both branches.
 */
export function applyMcpInitFailurePolicy(
  error: unknown,
  context: { runtime: { ready: boolean } },
  containerLiveness: boolean,
): void {
  if (containerLiveness) {
    process.stderr.write(
      `[mcp-init] ${error instanceof Error ? error.message : String(error)}\n`,
    );
    context.runtime.ready = false;
    return;
  }
  throw error;
}

async function startWorkflowMcpServer(): Promise<void> {
  const preflight = assertWorkflowMcpPreflight(process.env);
  const containerLiveness = process.env.SANGFOR_DOCKER_LIVENESS === '1';
  const [handlerModule, catalogModule, contextModule] = await Promise.all([
    import('./json-rpc-handler.js'),
    import('./tool-catalog.js'),
    import('./tool-context.js'),
  ]);
  const { handleWorkflowJsonRpc } = handlerModule;
  const { createWorkflowToolCatalog } = catalogModule;
  const { createWorkflowToolContext, initializeWorkflowToolContext } = contextModule;
  const context = createWorkflowToolContext();
  const catalog = createWorkflowToolCatalog(context);
  try {
    await initializeWorkflowToolContext(context);
  } catch (error: unknown) {
    applyMcpInitFailurePolicy(error, context, containerLiveness);
  }

  const input = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });
  let closing = false;
  const close = async (): Promise<void> => {
    if (closing) return;
    closing = true;
    input.close();
    await closeContext(context);
  };
  process.once('SIGTERM', () => void close());
  process.once('SIGINT', () => void close());
  input.once('close', () => {
    if (closing) return;
    closing = true;
    void closeContext(context);
  });
  input.on('line', (line) => {
    if (!line.trim()) return;
    void (async () => {
      let request: JsonRpcRequest;
      try {
        request = parseRequest(line);
      } catch (error) {
        if (!(error instanceof Error)) throw error;
        process.stdout.write(`${JSON.stringify({
          jsonrpc: '2.0',
          id: null,
          error: { code: -32700, message: 'PARSE_ERROR' },
        })}\n`);
        return;
      }
      const response = await handleWorkflowJsonRpc(request, {
        catalog,
        authenticate: () => authenticateWorkflowApiKey(readCredential(request), {
          apiKey: preflight.mcpApiKey,
          principalId: preflight.principalId,
        }),
      });
      process.stdout.write(`${JSON.stringify(response)}\n`);
    })();
  });
  process.stderr.write('sangfor-mcp-workflow stdio server started\n');
  process.stderr.write('Registered 26 MCP tools\n');
}

const modulePath = fileURLToPath(import.meta.url);
const entrypoint = process.argv[1];
if (entrypoint && resolve(entrypoint) === modulePath) {
  startWorkflowMcpServer().catch((error: unknown) => {
    if (error instanceof UnsafeAuthConfigurationError) {
      process.stderr.write(`${error.code}\n`);
      process.exitCode = error.exitCode;
      return;
    }
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

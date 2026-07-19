import {
  IdentityConflictError,
  MutationDeniedError,
  enforceServerIdentity,
  stripCallerIdentityFields,
  type AuthContext,
} from '../../../packages/shared/src/mutation-policy.js';
import { listWorkflowTools } from './tool-catalog.js';
import type { JsonRpcRequest, ToolDefinition } from './tool-types.js';

type ServerPrincipal = {
  readonly principalId: string;
  readonly role: string;
  readonly source: string;
};

type HandlerOptions = {
  readonly catalog: ReadonlyMap<string, ToolDefinition>;
  readonly authenticate: (
    request: JsonRpcRequest,
  ) => ServerPrincipal | null | Promise<ServerPrincipal | null>;
};

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorResponse(request: JsonRpcRequest, code: number, message: string) {
  return { jsonrpc: '2.0', id: request.id ?? null, error: { code, message } };
}

export async function handleWorkflowJsonRpc(
  request: JsonRpcRequest,
  options: HandlerOptions,
) {
  let principal: ServerPrincipal | null;
  try {
    principal = await options.authenticate(request);
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    return errorResponse(request, -32001, 'UNAUTHENTICATED');
  }
  if (!principal) return errorResponse(request, -32001, 'UNAUTHENTICATED');
  if (principal.role !== 'operator' || principal.source !== 'api_key') {
    return errorResponse(request, -32003, 'FORBIDDEN');
  }
  const authContext: AuthContext = {
    principalId: principal.principalId,
    role: 'operator',
    source: 'api_key',
  };

  if (request.method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id: request.id ?? null,
      result: {
        protocolVersion: '2025-06-18',
        serverInfo: { name: 'sangfor-mcp-workflow', version: '0.2.0' },
        capabilities: { tools: { listChanged: false } },
      },
    };
  }
  if (request.method === 'tools/list') {
    return {
      jsonrpc: '2.0',
      id: request.id ?? null,
      result: { tools: listWorkflowTools(options.catalog) },
    };
  }
  if (request.method !== 'tools/call') {
    return errorResponse(request, -32601, 'METHOD_NOT_FOUND');
  }

  if (!isRecord(request.params) || typeof request.params.name !== 'string') {
    return errorResponse(request, -32602, 'INVALID_PARAMS');
  }
  const rawArguments = request.params.arguments;
  const args = rawArguments === undefined ? {} : rawArguments;
  if (!isRecord(args)) return errorResponse(request, -32602, 'INVALID_PARAMS');

  try {
    enforceServerIdentity(authContext, args);
    const sanitizedArgs = stripCallerIdentityFields(args);
    const tool = options.catalog.get(request.params.name);
    if (!tool) return errorResponse(request, -32601, 'METHOD_NOT_FOUND');
    const result = await tool.handler(sanitizedArgs, authContext);
    return {
      jsonrpc: '2.0',
      id: request.id ?? null,
      result: {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) ?? 'null' }],
        structuredContent: result,
        isError: false,
      },
    };
  } catch (error) {
    if (error instanceof IdentityConflictError) {
      return errorResponse(request, -32602, 'IDENTITY_CONFLICT');
    }
    if (error instanceof MutationDeniedError) {
      return errorResponse(request, -32003, 'FORBIDDEN');
    }
    if (error instanceof TypeError) {
      return errorResponse(request, -32602, 'INVALID_PARAMS');
    }
    if (!(error instanceof Error)) throw error;
    return errorResponse(request, -32603, 'INTERNAL_ERROR');
  }
}

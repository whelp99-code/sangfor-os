import { readFileSync } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  McpStdioClient,
  type McpSpawnOptions,
} from '@sangfor/workflow-engine';
import { applyMcpInitFailurePolicy } from './index.js';
import { handleWorkflowJsonRpc } from './json-rpc-handler.js';
import { createWorkflowToolCatalog, listWorkflowTools } from './tool-catalog.js';
import {
  createWorkflowToolContext,
  initializeWorkflowToolContext,
} from './tool-context.js';
import type { AuthContext } from '../../../packages/shared/src/mutation-policy.js';

const AUTH_CONTEXT: AuthContext = {
  principalId: 'workflow-mcp-operator',
  role: 'operator',
  source: 'api_key',
};
const RAW_WORKFLOW_KEY = 'direct-workflow-raw-key-that-must-not-cross';
const RAW_DIRECT_MCP_KEY = 'direct-mcp-raw-key-that-must-not-cross';
const EXPECTED_CHILD_KEY = '1540987404fb38973aae1996133cd2a72113b978202923489151ad44117a8fb7';

const EXPECTED_TOOLS = [
  'sangfor_workflow.generate_smart_workflow',
  'sangfor_workflow.approve_workflow',
  'sangfor_workflow.reject_workflow',
  'sangfor_workflow.execute_workflow',
  'sangfor_workflow.get_workflow_status',
  'sangfor_workflow.list_workflows',
  'sangfor_workflow.get_execution_logs',
  'sangfor_workflow.get_mcp_status',
  'sangfor_workflow.list_mcp_tools',
  'sangfor_workflow.run_health_check',
  'sangfor_workflow.run_auto_wiki_pipeline',
  'sangfor_workflow.search_obsidian_notes',
  'sangfor_workflow.parse_excel',
  'sangfor_workflow.compare_vendors',
  'sangfor_workflow.compare_sangfor_vs_competitors',
  'sangfor_workflow.generate_comparison_report',
  'sangfor_workflow.generate_recommendation_doc',
  'sangfor_workflow.generate_custom_guide',
  'sangfor_workflow.list_vendor_categories',
  'sangfor_workflow.get_device_snapshot',
  'sangfor_workflow.plan_configuration_change',
  'sangfor_workflow.validate_operation_plan',
  'sangfor_workflow.request_operation_approval',
  'sangfor_workflow.apply_approved_operation',
  'sangfor_workflow.verify_configuration',
  'sangfor_workflow.generate_evidence_report',
] as const;

function callTool(
  name: string,
  argumentsValue: Readonly<Record<string, unknown>>,
  catalog: ReturnType<typeof createWorkflowToolCatalog>,
  principal: Readonly<{ principalId: string; role: string; source: string }> | null = AUTH_CONTEXT,
) {
  return handleWorkflowJsonRpc(
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: argumentsValue },
    },
    { catalog, authenticate: () => principal },
  );
}

describe('workflow MCP tool catalog', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('SANGFOR_API_KEY', RAW_WORKFLOW_KEY);
    vi.stubEnv('MCP_API_KEY', RAW_DIRECT_MCP_KEY);
    vi.stubEnv('SANGFOR_OPERATOR_PRINCIPAL_ID', AUTH_CONTEXT.principalId);
    vi.stubEnv('WHELP99_ENFORCE_SAFE_TOOLS', 'true');
    vi.stubEnv('AUTH_BYPASS_ENABLED', '0');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('rejects failed initialization only after cleanup and permits a clean retry', async () => {
    // Given: startup fails and child cleanup is held by a deterministic deferred promise.
    const context = createWorkflowToolContext();
    vi.spyOn(context.runtime.mcpClient, 'start')
      .mockRejectedValueOnce(new Error('startup failed'))
      .mockResolvedValueOnce();
    vi.spyOn(context.runtime.mcpClient, 'isConnected').mockReturnValue(true);
    vi.spyOn(context.toolRegistry, 'registerFromMcpServer').mockResolvedValue();
    let releaseStop: (() => void) | undefined;
    const stopSettled = new Promise<void>((resolve) => { releaseStop = resolve; });
    const stop = vi.spyOn(context.runtime.mcpClient, 'stop').mockReturnValueOnce(stopSettled);
    let initializationSettled = false;

    // When: initialization enters its failure cleanup path.
    const initialization = initializeWorkflowToolContext(context).finally(() => {
      initializationSettled = true;
    });
    const failure = initialization.then(
      () => null,
      (error: unknown) => error,
    );
    await vi.waitFor(() => expect(stop).toHaveBeenCalledTimes(1));

    // Then: rejection remains pending until stop, and the same context can retry cleanly.
    expect(initializationSettled).toBe(false);
    releaseStop?.();
    expect(await failure).toEqual(new Error('startup failed'));
    expect(initializationSettled).toBe(true);
    expect(context.runtime.ready).toBe(false);
    context.toolRegistry.register({
      name: 'retry_probe',
      description: 'retry readiness fixture',
      inputSchema: { type: 'object' },
      category: 'test',
      tags: ['test'],
      estimatedDuration: '1ms',
      riskLevel: 'low',
      requiresApproval: false,
      handler: async () => ({ ok: true }),
    });
    await initializeWorkflowToolContext(context);
    expect(context.runtime.ready).toBe(true);
  });

  it('uses the shared domain-separated launch for direct MCP and leaves no child residue', async () => {
    // Given: distinct raw workflow/direct-MCP keys and a capture around the real engineer client.
    let launch: { readonly serverPath: string; readonly options: McpSpawnOptions } | undefined;
    const context = createWorkflowToolContext({
      environment: {
        ...process.env,
        NODE_ENV: 'production',
        PATH: `${dirname(process.execPath)}:/usr/bin:/bin`,
        SANGFOR_API_KEY: RAW_WORKFLOW_KEY,
        MCP_API_KEY: RAW_DIRECT_MCP_KEY,
        SANGFOR_OPERATOR_PRINCIPAL_ID: AUTH_CONTEXT.principalId,
        WHELP99_ENFORCE_SAFE_TOOLS: 'true',
      },
      createMcpClient: (serverPath, options) => {
        launch = { serverPath, options };
        return new McpStdioClient(serverPath, options);
      },
    });

    try {
      // When: the direct MCP context initializes and calls the actual engineer child.
      await initializeWorkflowToolContext(context);
      const products = await context.runtime.mcpClient.callTool('sangfor.products', {});

      // Then: only the derived key crosses the exact absolute replace-env launch boundary.
      expect(context.runtime.ready).toBe(true);
      expect(products).toEqual(expect.objectContaining({ products: expect.any(Array) }));
      expect(launch).toBeDefined();
      if (!launch) throw new TypeError('Expected direct MCP launch capture');
      expect(isAbsolute(launch.serverPath)).toBe(true);
      expect(isAbsolute(launch.options.command ?? '')).toBe(true);
      expect(launch.options.command).toBe(process.execPath);
      expect(launch.options.args?.every(isAbsolute)).toBe(true);
      expect(launch.options.envMode).toBe('replace');
      expect(Object.isFrozen(launch.options)).toBe(true);
      expect(Object.isFrozen(launch.options.args)).toBe(true);
      expect(Object.isFrozen(launch.options.env)).toBe(true);
      expect(launch.options.requestApiKey).toBe(EXPECTED_CHILD_KEY);
      expect(launch.options.env?.SANGFOR_API_KEY).toBe(EXPECTED_CHILD_KEY);
      expect(launch.options.env).not.toHaveProperty('MCP_API_KEY');
      const serializedLaunch = JSON.stringify(launch);
      expect(serializedLaunch).not.toContain(RAW_WORKFLOW_KEY);
      expect(serializedLaunch).not.toContain(RAW_DIRECT_MCP_KEY);
    } finally {
      await context.runtime.mcpClient.stop();
    }

    expect(context.runtime.mcpClient.isConnected()).toBe(false);
    expect(context.runtime.ready).toBe(false);
  });

  it('assembles the exact 26-tool catalog in the required namespace', () => {
    // Given: a freshly constructed workflow tool context.
    const context = createWorkflowToolContext();

    // When: the three factories are assembled into the public catalog.
    const tools = listWorkflowTools(createWorkflowToolCatalog(context));

    // Then: the exact key set is present with no duplicate or extra tool.
    expect(tools.map((tool) => tool.name).sort()).toEqual([...EXPECTED_TOOLS].sort());
    expect(new Set(tools.map((tool) => tool.name)).size).toBe(26);
  });

  it.each([
    ['missing credential', null, -32001, 'UNAUTHENTICATED'],
    ['non-operator context', { principalId: 'viewer', role: 'viewer', source: 'api_key' }, -32003, 'FORBIDDEN'],
  ])('denies initialize, list, and call without enumeration for %s', async (_caseName, principal, code, message) => {
    // Given: a catalog with an observable handler and an unauthorized server context.
    const context = createWorkflowToolContext();
    const catalog = createWorkflowToolCatalog(context);
    const handler = vi.spyOn(context.executionLogger, 'getLogs');

    // When: all protected MCP methods are called.
    const requests = await Promise.all([
      handleWorkflowJsonRpc({ jsonrpc: '2.0', id: 1, method: 'initialize' }, { catalog, authenticate: () => principal }),
      handleWorkflowJsonRpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, { catalog, authenticate: () => principal }),
      callTool('sangfor_workflow.get_execution_logs', { workflowId: 'wf-1' }, catalog, principal),
    ]);

    // Then: every response is a JSON-RPC error and no tool handler is invoked.
    for (const response of requests) {
      expect(response).toEqual(expect.objectContaining({ error: { code, message } }));
      expect(response).not.toHaveProperty('result');
    }
    expect(handler).toHaveBeenCalledTimes(0);
  });

  it('substitutes the authenticated principal for redundant caller identity', async () => {
    // Given: an existing operation plan and an authenticated operator.
    const context = createWorkflowToolContext();
    context.operationPlans.set('plan-1', { id: 'plan-1' });
    const catalog = createWorkflowToolCatalog(context);

    // When: approval is requested with a matching redundant display identity.
    const response = await callTool(
      'sangfor_workflow.request_operation_approval',
      { planId: 'plan-1', requestedBy: AUTH_CONTEXT.principalId },
      catalog,
    );

    // Then: the persisted attribution is the server principal.
    expect(response).toHaveProperty('result');
    expect(Array.from(context.operationApprovals.values())[0]).toEqual(
      expect.objectContaining({ requestedBy: AUTH_CONTEXT.principalId }),
    );
  });

  it('rejects conflicting identity before persistence', async () => {
    // Given: an existing operation plan and an empty approval map.
    const context = createWorkflowToolContext();
    context.operationPlans.set('plan-1', { id: 'plan-1' });
    const catalog = createWorkflowToolCatalog(context);

    // When: caller identity conflicts with the authenticated principal.
    const response = await callTool(
      'sangfor_workflow.request_operation_approval',
      { planId: 'plan-1', requestedBy: 'caller-controlled' },
      catalog,
    );

    // Then: JSON-RPC maps the conflict exactly and persists nothing.
    expect(response).toEqual(expect.objectContaining({
      error: { code: -32602, message: 'IDENTITY_CONFLICT' },
    }));
    expect(response).not.toHaveProperty('result');
    expect(context.operationApprovals.size).toBe(0);
  });

  it('strips matching recursive identities before a tool handler', async () => {
    // Given: a minimal observable tool and all eight matching identities.
    const handler = vi.fn((args: Readonly<Record<string, unknown>>) => args);
    const catalog = new Map([['test.identity', {
      description: 'identity boundary fixture',
      inputSchema: {},
      handler,
    }]]);
    const argumentsValue = {
      keep: 'value',
      approvedBy: AUTH_CONTEXT.principalId,
      nested: {
        actorId: AUTH_CONTEXT.principalId,
        requestedBy: AUTH_CONTEXT.principalId,
        values: [
          { requester: AUTH_CONTEXT.principalId, approver: AUTH_CONTEXT.principalId },
          {
            approverId: AUTH_CONTEXT.principalId,
            approverPersonaId: AUTH_CONTEXT.principalId,
            personaId: AUTH_CONTEXT.principalId,
          },
        ],
      },
    };

    // When: the authenticated MCP request crosses the JSON-RPC handler.
    const response = await callTool('test.identity', argumentsValue, catalog);

    // Then: the tool receives only non-identity data and the trusted context.
    expect(response).toHaveProperty('result');
    expect(handler).toHaveBeenCalledWith(
      { keep: 'value', nested: { values: [{}, {}] } },
      AUTH_CONTEXT,
    );
  });

  it('rejects a nested identity conflict before a tool handler', async () => {
    // Given: a minimal observable tool and a nested conflicting actor.
    const handler = vi.fn();
    const catalog = new Map([['test.identity', {
      description: 'identity boundary fixture',
      inputSchema: {},
      handler,
    }]]);

    // When: a nested array carries caller-controlled identity.
    const response = await callTool(
      'test.identity',
      { nested: [{ actorId: 'caller-controlled' }] },
      catalog,
    );

    // Then: JSON-RPC returns the exact conflict and never invokes the tool.
    expect(response).toEqual(expect.objectContaining({
      error: { code: -32602, message: 'IDENTITY_CONFLICT' },
    }));
    expect(handler).toHaveBeenCalledTimes(0);
  });

  it('denies contained mutation before the operation adapter is called', async () => {
    // Given: an apparently approved operation with a mutation spy.
    const context = createWorkflowToolContext();
    context.operationPlans.set('plan-1', { id: 'plan-1', status: 'approved' });
    context.operationApprovals.set('approval-1', {
      id: 'approval-1',
      planId: 'plan-1',
      status: 'approved',
    });
    const mutationSpy = vi.spyOn(context.operationOrchestrator, 'executeWithVerification');
    const catalog = createWorkflowToolCatalog(context);

    // When: a valid operator requests live application.
    const response = await callTool(
      'sangfor_workflow.apply_approved_operation',
      { planId: 'plan-1', approvalId: 'approval-1' },
      catalog,
    );

    // Then: containment is a JSON-RPC denial and the adapter call count is exactly zero.
    expect(response).toEqual(expect.objectContaining({ error: { code: -32003, message: 'FORBIDDEN' } }));
    expect(response).not.toHaveProperty('result');
    expect(mutationSpy).toHaveBeenCalledTimes(0);
  });

  it('keeps the stdio composition entrypoint within the 200-line ceiling', () => {
    // Given / When: the split entrypoint is counted by physical lines, a stricter upper bound here.
    const indexLines = readFileSync(new URL('./index.ts', import.meta.url), 'utf8').split('\n').length;

    // Then: it stays within the card ceiling.
    expect(indexLines).toBeLessThanOrEqual(200);
  });

  describe('D3 applyMcpInitFailurePolicy (fail-closed vs docker liveness)', () => {
    it('rethrows when containerLiveness is false (production fail-closed)', () => {
      // Given: production/default path (SANGFOR_DOCKER_LIVENESS unset → false)
      const context = { runtime: { ready: true } };
      const initError = new Error('engineer MCP child unavailable');

      // When/Then: init failure rethrows so startWorkflowMcpServer aborts
      expect(() => applyMcpInitFailurePolicy(initError, context, false)).toThrow(
        'engineer MCP child unavailable',
      );
      expect(context.runtime.ready).toBe(true);
    });

    it('swallows and sets ready=false when containerLiveness is true', () => {
      // Given: Docker smoke path (SANGFOR_DOCKER_LIVENESS=1)
      const context = { runtime: { ready: true } };
      const initError = new Error('engineer MCP child unavailable');
      const writeSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

      // When: soft-fail branch runs
      expect(() => applyMcpInitFailurePolicy(initError, context, true)).not.toThrow();

      // Then: process continues degraded
      expect(context.runtime.ready).toBe(false);
      expect(writeSpy).toHaveBeenCalledWith(
        expect.stringContaining('[mcp-init] engineer MCP child unavailable'),
      );
      writeSpy.mockRestore();
    });
  });
});

/**
 * MCP bootstrap — sangfor-engineer-mcp 연결 및 ToolRegistry wiring
 */

import { join, resolve } from 'node:path';
import { createLogger } from '@sangfor/workflow-shared';
import {
  createDomainSeparatedEngineerMcpClient,
  type McpStdioClient,
  type McpSpawnOptions,
  type ToolRegistry,
} from '@sangfor/workflow-engine';

const log = createLogger('mcp-bootstrap');

const MCP_TOOL_ALIASES: Record<string, string> = {
  capture_screenshots: 'sangfor.capture_screenshots',
  search_manuals: 'sangfor.search_manuals',
  import_excel: 'sangfor.import_excel',
  run_health_check: 'sangfor.run_health_check',
  generate_setting_guide_docx: 'sangfor.generate_setting_guide_docx',
  generate_setting_guide_pptx: 'sangfor.generate_setting_guide_pptx',
};

function resolveMcpCwd(workflowCwd: string): string {
  // Default to the in-repo sibling service (services/sangfor-engineer-mcp);
  // workflowCwd is services/sangfor-mcp-workflow. Previously this pointed at a
  // hardcoded ~/Documents clone, which silently fell back to stub tools.
  return resolve(
    process.env.SANGFOR_MCP_CWD ?? join(workflowCwd, '..', 'sangfor-engineer-mcp'),
  );
}

export async function bootstrapMcpClient(
  toolRegistry: ToolRegistry,
  workflowCwd: string,
  createClient?: (
    serverPath: string,
    spawnOptions: McpSpawnOptions,
  ) => McpStdioClient,
): Promise<McpStdioClient> {
  const mcpCwd = resolveMcpCwd(workflowCwd);
  const client = createDomainSeparatedEngineerMcpClient({
    workflowRoot: workflowCwd,
    engineerRoot: mcpCwd,
    environment: process.env,
    requestTimeoutMs: 30_000,
  }, createClient);

  try {
    await client.start();
    toolRegistry.setMcpClient(client);
    await toolRegistry.registerFromMcpServer();
    wireWorkflowToolAliases(toolRegistry, client);
    if (!toolRegistry.hasTool('sangfor.products') || !toolRegistry.hasTool('search_manuals')) {
      throw new Error('Engineer MCP tool registration incomplete');
    }
    log.info('MCP tools registered successfully');
    return client;
  } catch (error) {
    await client.stop();
    throw error;
  }
}

function wireWorkflowToolAliases(toolRegistry: ToolRegistry, client: McpStdioClient): void {
  for (const [localName, mcpName] of Object.entries(MCP_TOOL_ALIASES)) {
    const existing = toolRegistry.getTool(localName) ?? toolRegistry.getTool(mcpName);
    if (!existing) continue;

    toolRegistry.register({
      ...existing,
      name: localName,
      handler: async (args: Record<string, unknown>) => client.callTool(mcpName, args),
    });
  }
}

export function getProductEnv(product: 'EPP' | 'IAG' | 'CC'): {
  targetUrl: string;
  username: string;
  password: string;
  outputDir: string;
} {
  const urls: Record<string, string> = {
    EPP: process.env.EPP_TARGET_URL ?? 'https://10.80.1.106',
    IAG: process.env.IAG_TARGET_URL ?? 'https://10.80.1.108',
    CC: process.env.CC_TARGET_URL ?? 'https://10.80.1.107',
  };

  return {
    targetUrl: urls[product],
    username: process.env[`${product}_USERNAME`] ?? 'admin',
    password: process.env[`${product}_PASSWORD`] ?? '',
    outputDir: join(process.cwd(), 'outputs', 'mcp-device-learn', product, 'screenshots'),
  };
}

export function toDeviceProduct(code: string): 'EPP' | 'IAG' | 'CC' {
  switch (code) {
    case 'ENDPOINT_SECURE':
    case 'EPP':
      return 'EPP';
    case 'CYBER_COMMAND':
    case 'CC':
      return 'CC';
    case 'IAG':
    default:
      return 'IAG';
  }
}

export function toGuideProduct(code: string): 'EPP' | 'IAG' | 'CC' {
  return toDeviceProduct(code);
}

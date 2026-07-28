/**
 * MCP Stdio Client — sangfor-engineer-mcp의 MCP tools를 stdio로 호출
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { createLogger } from '@sangfor/workflow-shared';
import { createDomainSeparatedEngineerMcpLaunch, UnsafeAuthConfigurationError, type EngineerMcpChildLaunchInput } from '../../shared/src/mutation-policy.js';

const log = createLogger('mcp-client');

// ─── 타입 정의 ──────────────────────────────────────────────────────────────

export type McpRequest = { jsonrpc: '2.0'; id: string | number; method: string; params?: unknown };
export type McpToolDescription = Readonly<{ name: string; description: string; inputSchema: Record<string, unknown> }>;
type McpResponseResult = Readonly<{ tools?: readonly McpToolDescription[];
  content?: readonly Readonly<{ text?: string }>[]; readonly [key: string]: unknown }>;

export type McpResponse = { jsonrpc: '2.0'; id: string | number; result?: McpResponseResult; error?: { code: number; message: string } };

// ─── MCP Stdio 클라이언트 ───────────────────────────────────────────────────

export interface McpSpawnOptions {
  readonly cwd?: string; readonly command?: string; readonly args?: readonly string[];
  readonly env?: Readonly<Record<string, string>>; readonly envMode?: 'merge' | 'replace';
  readonly requestApiKey?: string; readonly requestTimeoutMs?: number;
}

type ProcessSpawnOptions = Omit<McpSpawnOptions, 'requestApiKey'>;
type PendingRequest = { resolve: (value: McpResponse) => void; reject: (error: Error) => void; timeout: NodeJS.Timeout };
export type EngineerMcpClientInput = Omit<EngineerMcpChildLaunchInput, 'requestApiKey'>;

export function createDomainSeparatedEngineerMcpClient(
  input: EngineerMcpClientInput, createClient: (serverPath: string, options: McpSpawnOptions) => McpStdioClient
    = (serverPath, options) => new McpStdioClient(serverPath, options),
): McpStdioClient {
  const rawWorkflowKey = input.environment.SANGFOR_API_KEY;
  if (rawWorkflowKey === undefined) throw new UnsafeAuthConfigurationError('missing SANGFOR_API_KEY');
  if (rawWorkflowKey.trim().length === 0) throw new UnsafeAuthConfigurationError('blank SANGFOR_API_KEY');
  const requestApiKey = createHmac('sha256', rawWorkflowKey).update('sangfor-engineer-mcp/stdio/v1', 'utf8').digest('hex');
  const launch = createDomainSeparatedEngineerMcpLaunch({ ...input, requestApiKey });
  return createClient(launch.serverPath, launch.spawnOptions);
}

export class McpStdioClient {
  private process: ChildProcess | null = null;
  private pendingRequests: Map<string | number, PendingRequest> = new Map();
  private buffer: string = '';
  private readonly serverPath: string;
  private readonly spawnOptions: Readonly<ProcessSpawnOptions>;
  private readonly requestApiKey: string | undefined;
  private disconnectHandler: (() => void) | undefined;
  private disconnectNotified = true;
  private initialized: boolean = false;

  constructor(serverPath: string, spawnOptions: McpSpawnOptions = {}) {
    const { requestApiKey, ...processSpawnOptions } = spawnOptions;
    this.serverPath = serverPath;
    this.spawnOptions = {
      ...processSpawnOptions,
      args: processSpawnOptions.args ? [...processSpawnOptions.args] : undefined,
      env: processSpawnOptions.env ? { ...processSpawnOptions.env } : undefined,
    };
    this.requestApiKey = requestApiKey?.trim() || undefined;
  }

  // 서버 시작
  async start(): Promise<void> {
    if (this.process) {
      log.warn('Server already running');
      return;
    }

    const command = this.spawnOptions.command ?? 'npx';
    const args = this.spawnOptions.args ?? ['tsx', this.serverPath];
    const cwd = this.spawnOptions.cwd ?? process.cwd();

    log.info(`Starting MCP server: ${command} ${args.join(' ')} (cwd: ${cwd})`);

    const childEnv = this.spawnOptions.envMode === 'replace'
      ? { ...this.spawnOptions.env }
      : { ...process.env, ...this.spawnOptions.env };
    const child = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd,
      env: childEnv,
    });
    this.process = child;
    this.disconnectNotified = false;

    child.stdout?.on('data', (data: Buffer) => {
      this.handleData(data.toString());
    });

    child.stderr?.on('data', (data: Buffer) => {
      log.debug(`stderr: ${data.toString().trim()}`);
    });

    child.on('error', (error) => {
      if (this.process === child) this.process = null;
      this.markDisconnected();
      this.rejectPendingRequests(error);
    });

    child.on('exit', (code, signal) => {
      log.info(`MCP server exited with code ${code}`);
      if (this.process === child) this.process = null;
      this.markDisconnected();
      const reason = code === null ? `signal ${signal ?? 'unknown'}` : `code ${code}`;
      this.rejectPendingRequests(new Error(`MCP server exited before response (${reason})`));
    });

    try {
      await this.initialize();
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  // 서버 중지
  async stop(): Promise<void> {
    const child = this.process;
    if (!child) {
      this.markDisconnected();
      return;
    }

    await new Promise<void>((resolve) => {
      let settled = false;
      const timers: { forceKill: NodeJS.Timeout | undefined } = { forceKill: undefined };
      const finish = () => {
        if (settled) return;
        settled = true;
        if (timers.forceKill) clearTimeout(timers.forceKill);
        resolve();
      };

      child.once('exit', finish);
      child.once('error', finish);
      if (child.exitCode !== null || child.signalCode !== null) {
        finish();
        return;
      }

      if (!child.kill('SIGTERM')) {
        finish();
        return;
      }
      timers.forceKill = setTimeout(() => {
        if (!settled) child.kill('SIGKILL');
      }, 5_000);
      timers.forceKill.unref();
    });

    if (this.process === child) this.process = null;
    this.markDisconnected();
    this.rejectPendingRequests(new Error('MCP server stopped'));
  }

  setDisconnectHandler(handler: (() => void) | undefined): void {
    this.disconnectHandler = handler;
  }

  private markDisconnected(): void {
    this.initialized = false;
    if (this.disconnectNotified) return;
    this.disconnectNotified = true;
    this.disconnectHandler?.();
  }

  // 초기화
  private async initialize(): Promise<void> {
    const result = await this.sendRequest({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'sangfor-mcp-workflow', version: '0.1.0' },
        ...(this.requestApiKey ? { _meta: { apiKey: this.requestApiKey } } : {}),
      },
    });

    if (result.error) {
      throw new Error(`Failed to initialize MCP server: ${result.error.message}`);
    }

    this.initialized = true;
    log.info('MCP server initialized');
  }

  // tool 목록 조회
  async listTools(): Promise<McpToolDescription[]> {
    const result = await this.sendRequest({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/list',
      params: this.requestApiKey ? { _meta: { apiKey: this.requestApiKey } } : undefined,
    });

    return result.result?.tools ? [...result.result.tools] : [];
  }

  // tool 호출
  async callTool<T = Record<string, unknown>>(name: string, args: Record<string, unknown> = {}): Promise<T> {
    if (!this.initialized) {
      throw new Error('MCP server not initialized');
    }

    log.info(`Calling tool: ${name}`);

    const result = await this.sendRequest({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: {
        name,
        arguments: args,
        ...(this.requestApiKey ? { _meta: { apiKey: this.requestApiKey } } : {}),
      },
    });

    if (result.error) {
      throw new Error(`Tool call failed: ${result.error.message}`);
    }

    // 결과 파싱
    const content = result.result?.content?.[0]?.text;
    if (content) {
      try {
        return JSON.parse(content) as T;
      } catch {
        return content as T;
      }
    }

    return result.result as T;
  }

  // 요청 전송
  private sendRequest(request: McpRequest): Promise<McpResponse> {
    return new Promise((resolve, reject) => {
      if (!this.process?.stdin) {
        reject(new Error('MCP server not running'));
        return;
      }

      const timeoutMs = this.spawnOptions.requestTimeoutMs ?? 600_000;
      const timeout = setTimeout(() => {
        if (this.pendingRequests.has(request.id)) {
          this.pendingRequests.delete(request.id);
          reject(new Error(`Request timeout: ${request.method}`));
        }
      }, timeoutMs);
      this.pendingRequests.set(request.id, { resolve, reject, timeout });

      const data = JSON.stringify(request) + '\n';
      this.process.stdin.write(data);
    });
  }

  private rejectPendingRequests(error: Error): void {
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }

  // 데이터 수신 처리
  private handleData(data: string): void {
    this.buffer += data;

    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const response: McpResponse = JSON.parse(line);
        const pending = this.pendingRequests.get(response.id);

        if (pending) {
          this.pendingRequests.delete(response.id);
          clearTimeout(pending.timeout);
          pending.resolve(response);
        }
      } catch {
        log.debug(`Failed to parse: ${line}`);
      }
    }
  }

  // 연결 상태 확인
  isConnected(): boolean {
    return this.process !== null && this.initialized;
  }
}

// ─── 싱글톤 인스턴스 ────────────────────────────────────────────────────────

let defaultClient: McpStdioClient | null = null;

export function getMcpClient(serverPath?: string): McpStdioClient {
  if (!defaultClient && serverPath) {
    defaultClient = new McpStdioClient(serverPath);
  }
  if (!defaultClient) {
    throw new Error('MCP client not initialized. Provide serverPath.');
  }
  return defaultClient;
}

import { createHash, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

export type AuthContext = {
  readonly principalId: string;
  readonly role: 'operator';
  readonly source: 'api_key';
};

type AuthConfiguration = {
  readonly apiKey: string | undefined;
  readonly principalId: string | undefined;
};

export type WorkflowEnvironment = Readonly<Record<string, string | undefined>>;

export type WorkflowMcpPreflight = {
  readonly mcpApiKey: string;
  readonly principalId: string;
};

export type EngineerMcpChildLaunch = {
  readonly serverPath: string;
  readonly spawnOptions: Readonly<{
    cwd: string;
    command: string;
    args: readonly string[];
    env: Readonly<Record<string, string>>;
    envMode: 'replace';
    requestApiKey: string;
    requestTimeoutMs: number;
  }>;
};

export type EngineerMcpChildLaunchInput = {
  readonly workflowRoot: string;
  readonly engineerRoot: string;
  readonly environment: WorkflowEnvironment;
  readonly requestApiKey: string;
  readonly requestTimeoutMs?: number;
};

const CALLER_IDENTITY_FIELDS = [
  'approvedBy',
  'actorId',
  'requestedBy',
  'requester',
  'approver',
  'approverId',
  'approverPersonaId',
  'personaId',
] as const;
export class UnsafeAuthConfigurationError extends Error {
  readonly name = 'UnsafeAuthConfigurationError';
  readonly code = 'UNSAFE_AUTH_CONFIGURATION';
  readonly exitCode = 78;

  constructor(readonly reason: string) {
    super('UNSAFE_AUTH_CONFIGURATION');
  }
}

export class IdentityConflictError extends Error {
  readonly name = 'IdentityConflictError';
  readonly code = 'IDENTITY_CONFLICT';

  constructor(readonly field: string) {
    super('IDENTITY_CONFLICT');
  }
}

export class MutationDeniedError extends Error {
  readonly name = 'MutationDeniedError';
  readonly code = 'MUTATION_CONTAINMENT_ACTIVE';

  constructor(readonly action: string) {
    super('MUTATION_CONTAINMENT_ACTIVE');
  }
}

function isEnabled(value: string | undefined): boolean {
  return value === '1' || value === 'true' || value === 'yes' || value === 'on';
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireNonBlank(environment: WorkflowEnvironment, key: string): string {
  const value = environment[key];
  if (value === undefined) throw new UnsafeAuthConfigurationError(`missing ${key}`);
  if (value.trim().length === 0) throw new UnsafeAuthConfigurationError(`blank ${key}`);
  return value;
}

function assertBypassesDisabled(environment: WorkflowEnvironment): void {
  if (isEnabled(environment.AUTH_BYPASS_ENABLED)) {
    throw new UnsafeAuthConfigurationError('auth bypass enabled');
  }
  if (
    isEnabled(environment.API_KEY_BYPASS_ENABLED)
    || isEnabled(environment.SANGFOR_API_KEY_BYPASS)
    || isEnabled(environment.MCP_AUTH_BYPASS_ENABLED)
  ) {
    throw new UnsafeAuthConfigurationError('api-key bypass enabled');
  }
}

function requireSafeTools(environment: WorkflowEnvironment): void {
  const value = requireNonBlank(environment, 'WHELP99_ENFORCE_SAFE_TOOLS').trim();
  if (value !== 'true') {
    throw new UnsafeAuthConfigurationError('safe-tool enforcement disabled');
  }
}

export function assertSafeWorkflowConfiguration(
  environment: WorkflowEnvironment,
  requiredApiKeyName: 'SANGFOR_API_KEY' | 'MCP_API_KEY',
): void {
  assertBypassesDisabled(environment);
  requireSafeTools(environment);
  requireNonBlank(environment, requiredApiKeyName);
  const companionApiKeyName = requiredApiKeyName === 'SANGFOR_API_KEY'
    ? 'MCP_API_KEY'
    : 'SANGFOR_API_KEY';
  requireNonBlank(environment, companionApiKeyName);
  requireNonBlank(environment, 'SANGFOR_OPERATOR_PRINCIPAL_ID');
}

export function assertWorkflowMcpPreflight(
  environment: WorkflowEnvironment,
): WorkflowMcpPreflight {
  assertBypassesDisabled(environment);
  const mcpApiKey = requireNonBlank(environment, 'MCP_API_KEY');
  requireNonBlank(environment, 'SANGFOR_API_KEY');
  const principalId = requireNonBlank(environment, 'SANGFOR_OPERATOR_PRINCIPAL_ID').trim();
  requireSafeTools(environment);
  return Object.freeze({ mcpApiKey, principalId });
}

function resolveEngineerTsx(engineerRoot: string, workflowRoot: string): string {
  for (const root of [engineerRoot, workflowRoot]) {
    const localTsx = join(root, 'node_modules/tsx/dist/cli.mjs');
    if (existsSync(localTsx)) return localTsx;
    const pnpmTsx = join(
      root,
      'node_modules/.pnpm/tsx@4.22.4/node_modules/tsx/dist/cli.mjs',
    );
    if (existsSync(pnpmTsx)) return pnpmTsx;
  }
  throw new UnsafeAuthConfigurationError('engineer MCP tsx CLI unavailable');
}

export function createDomainSeparatedEngineerMcpLaunch(
  input: EngineerMcpChildLaunchInput,
): EngineerMcpChildLaunch {
  assertBypassesDisabled(input.environment);
  requireSafeTools(input.environment);
  if (!/^[0-9a-f]{64}$/.test(input.requestApiKey)) {
    throw new UnsafeAuthConfigurationError('invalid derived engineer MCP key');
  }
  const principalId = requireNonBlank(
    input.environment,
    'SANGFOR_OPERATOR_PRINCIPAL_ID',
  ).trim();
  const path = requireNonBlank(input.environment, 'PATH');
  const home = requireNonBlank(input.environment, 'HOME');
  const workflowRoot = resolve(input.workflowRoot);
  const engineerRoot = resolve(input.engineerRoot);
  const serverPath = join(engineerRoot, 'apps/mcp-server/src/index.ts');
  const tsconfigPath = join(engineerRoot, 'tsconfig.json');
  if (!existsSync(serverPath) || !existsSync(tsconfigPath)) {
    throw new UnsafeAuthConfigurationError('engineer MCP runtime unavailable');
  }
  const args = Object.freeze([resolveEngineerTsx(engineerRoot, workflowRoot), serverPath]);
  const env = Object.freeze({
    PATH: path,
    HOME: home,
    TMPDIR: input.environment.TMPDIR?.trim() || '/tmp',
    LANG: input.environment.LANG?.trim() || 'C',
    LC_ALL: input.environment.LC_ALL?.trim() || 'C',
    NODE_ENV: input.environment.NODE_ENV?.trim() || 'development',
    AUTH_BYPASS_ENABLED: '0',
    SANGFOR_DB_ENABLED: '0',
    SANGFOR_OCR_DIR: join(workflowRoot, 'outputs', 'captcha-ocr'),
    SANGFOR_API_KEY: input.requestApiKey,
    SANGFOR_OPERATOR_PRINCIPAL_ID: principalId,
    WHELP99_ENFORCE_SAFE_TOOLS: 'true',
    TSX_TSCONFIG_PATH: tsconfigPath,
    NO_PROXY: input.environment.NO_PROXY?.trim() || '127.0.0.1,localhost',
    HTTP_PROXY: input.environment.HTTP_PROXY ?? '',
    HTTPS_PROXY: input.environment.HTTPS_PROXY ?? '',
    ALL_PROXY: input.environment.ALL_PROXY ?? '',
  });
  return Object.freeze({
    serverPath,
    spawnOptions: Object.freeze({
      cwd: engineerRoot,
      command: process.execPath,
      args,
      env,
      envMode: 'replace' as const,
      requestApiKey: input.requestApiKey,
      requestTimeoutMs: input.requestTimeoutMs ?? 30_000,
    }),
  });
}

export function authenticateWorkflowApiKey(
  presentedKey: string | undefined,
  configuration: AuthConfiguration,
): AuthContext | null {
  if (!presentedKey || !configuration.apiKey || !configuration.principalId) return null;

  const presentedDigest = createHash('sha256').update(presentedKey, 'utf8').digest();
  const configuredDigest = createHash('sha256').update(configuration.apiKey, 'utf8').digest();
  if (!timingSafeEqual(presentedDigest, configuredDigest)) return null;

  return {
    principalId: configuration.principalId,
    role: 'operator',
    source: 'api_key',
  };
}

export function requireOperatorPrincipal(context: unknown): string {
  if (
    !isRecord(context)
    || typeof context.principalId !== 'string'
    || context.principalId.length === 0
    || context.role !== 'operator'
    || context.source !== 'api_key'
  ) {
    throw new TypeError('UNAUTHENTICATED');
  }
  return context.principalId;
}

export function enforceServerIdentity(context: AuthContext, input: unknown): string {
  const principalId = requireOperatorPrincipal(context);
  const conflict = findIdentityConflict(input, principalId);
  if (conflict) throw new IdentityConflictError(conflict);
  return principalId;
}

function findIdentityConflict(input: unknown, principalId: string): string | undefined {
  if (Array.isArray(input)) {
    for (const value of input) {
      const conflict = findIdentityConflict(value, principalId);
      if (conflict) return conflict;
    }
    return undefined;
  }
  if (!isRecord(input)) return undefined;
  for (const [field, value] of Object.entries(input)) {
    if (CALLER_IDENTITY_FIELDS.some(identityField => identityField === field)
      && value !== principalId) return field;
    const conflict = findIdentityConflict(value, principalId);
    if (conflict) return conflict;
  }
  return undefined;
}

export function stripCallerIdentityFields(
  input: Readonly<Record<string, unknown>>,
): Record<string, unknown>;
export function stripCallerIdentityFields(input: unknown): unknown;
export function stripCallerIdentityFields(input: unknown): unknown {
  if (Array.isArray(input)) return input.map(stripCallerIdentityFields);
  if (!isRecord(input)) return input;
  return Object.fromEntries(
    Object.entries(input)
      .filter(([field]) => !CALLER_IDENTITY_FIELDS.some(identityField => identityField === field))
      .map(([field, value]) => [field, stripCallerIdentityFields(value)]),
  );
}

export function denyWorkflowMutation(action: string): void {
  throw new MutationDeniedError(action);
}

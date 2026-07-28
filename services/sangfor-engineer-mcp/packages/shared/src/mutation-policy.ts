import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';

export const UNSAFE_AUTH_CONFIGURATION = 'UNSAFE_AUTH_CONFIGURATION' as const;
export const MUTATION_CONTAINED_BY_U002 = 'MUTATION_CONTAINED_BY_U002' as const;

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

const API_KEY_BYPASS_FIELDS = [
  'AUTH_BYPASS_ENABLED',
  'API_KEY_BYPASS_ENABLED',
  'API_KEY_AUTH_BYPASS_ENABLED',
  'MCP_API_KEY_BYPASS_ENABLED',
] as const;

export type AuthContext = Readonly<{
  principalId: string;
  role: 'operator';
  source: 'api_key';
}>;

export type HttpAuthorizationDecision =
  | Readonly<{ allowed: true; context: AuthContext }>
  | Readonly<{
      allowed: false;
      status: 401 | 403;
      error: 'UNAUTHENTICATED' | 'FORBIDDEN';
    }>;

export type CallerIdentityConflict = Readonly<{
  field: string;
  received: unknown;
}>;

export type ContainedMutation = 'live_device' | 'product_change' | 'wiki_sync';

type AuthConfiguration = Readonly<{
  apiKey: string;
  principalId: string;
}>;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function firstHeader(value: string | readonly string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : value?.[0];
}

function bearerToken(value: string | undefined): string | undefined {
  if (!value?.startsWith('Bearer ')) return undefined;
  const token = value.slice('Bearer '.length).trim();
  return token || undefined;
}

function isEnabled(value: string | undefined): boolean {
  return value === '1' || value?.toLowerCase() === 'true' || value?.toLowerCase() === 'yes' || value?.toLowerCase() === 'on';
}

function constantTimeMatches(provided: string, expected: string): boolean {
  const providedDigest = createHash('sha256').update(provided).digest();
  const expectedDigest = createHash('sha256').update(expected).digest();
  return timingSafeEqual(providedDigest, expectedDigest);
}

function readAuthConfiguration(env: NodeJS.ProcessEnv): AuthConfiguration | undefined {
  const apiKey = env.SANGFOR_API_KEY?.trim();
  const principalId = env.SANGFOR_OPERATOR_PRINCIPAL_ID?.trim();
  if (!apiKey || !principalId) return undefined;
  return { apiKey, principalId };
}

export function productionAuthConfigurationIssues(env: NodeJS.ProcessEnv): readonly string[] {
  if (env.NODE_ENV !== 'production') return [];

  const issues: string[] = [];
  for (const field of API_KEY_BYPASS_FIELDS) {
    if (isEnabled(env[field])) issues.push(field);
  }
  if (env.WHELP99_ENFORCE_SAFE_TOOLS !== 'true') issues.push('WHELP99_ENFORCE_SAFE_TOOLS');
  if (!env.SANGFOR_API_KEY?.trim()) issues.push('SANGFOR_API_KEY');
  if (!env.SANGFOR_OPERATOR_PRINCIPAL_ID?.trim()) issues.push('SANGFOR_OPERATOR_PRINCIPAL_ID');
  return issues;
}

export function enforceProductionAuthPreflight(env: NodeJS.ProcessEnv = process.env): void {
  if (productionAuthConfigurationIssues(env).length === 0) return;
  process.stderr.write(`${UNSAFE_AUTH_CONFIGURATION}\n`);
  process.exit(78);
}

export function extractHttpApiKey(headers: IncomingHttpHeaders): string | undefined {
  return bearerToken(firstHeader(headers.authorization))
    ?? firstHeader(headers['x-api-key'])?.trim()
    ?? firstHeader(headers['x-sangfor-api-key'])?.trim();
}

export function extractMcpApiKey(params: unknown): string | undefined {
  if (!isRecord(params)) return undefined;
  const metadata = isRecord(params._meta)
    ? params._meta
    : isRecord(params.metadata)
      ? params.metadata
      : undefined;
  if (!metadata) return undefined;

  const apiKey = metadata.apiKey ?? metadata.api_key;
  if (typeof apiKey === 'string' && apiKey.trim()) return apiKey.trim();
  return typeof metadata.authorization === 'string'
    ? bearerToken(metadata.authorization)
    : undefined;
}

export function authenticateApiKey(provided: string | undefined, env: NodeJS.ProcessEnv = process.env): AuthContext | undefined {
  const configuration = readAuthConfiguration(env);
  if (!provided || !configuration || !constantTimeMatches(provided, configuration.apiKey)) return undefined;
  return {
    principalId: configuration.principalId,
    role: 'operator',
    source: 'api_key',
  };
}

export function isOperatorContext(value: unknown): value is AuthContext {
  if (!isRecord(value)) return false;
  return typeof value.principalId === 'string'
    && value.principalId.length > 0
    && value.role === 'operator'
    && value.source === 'api_key';
}

export function authorizeHttpContext(value: unknown): HttpAuthorizationDecision {
  if (value === undefined || value === null) {
    return { allowed: false, status: 401, error: 'UNAUTHENTICATED' };
  }
  if (!isOperatorContext(value)) {
    return { allowed: false, status: 403, error: 'FORBIDDEN' };
  }
  return { allowed: true, context: value };
}

export function findCallerIdentityConflict(value: unknown, context: AuthContext): CallerIdentityConflict | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const conflict = findCallerIdentityConflict(item, context);
      if (conflict) return conflict;
    }
    return undefined;
  }
  if (!isRecord(value)) return undefined;

  for (const [field, candidate] of Object.entries(value)) {
    if (CALLER_IDENTITY_FIELDS.some(identityField => identityField === field)
      && candidate !== context.principalId) {
      return { field, received: candidate };
    }
    const nestedConflict = findCallerIdentityConflict(candidate, context);
    if (nestedConflict) return nestedConflict;
  }
  return undefined;
}

function stripCallerIdentityFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripCallerIdentityFields);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([field]) => !CALLER_IDENTITY_FIELDS.some(identityField => identityField === field))
      .map(([field, candidate]) => [field, stripCallerIdentityFields(candidate)]),
  );
}

export function withServerActor(value: unknown, context: AuthContext): Readonly<Record<string, unknown>> {
  const sanitized = stripCallerIdentityFields(value);
  return isRecord(sanitized)
    ? { ...sanitized, actorId: context.principalId }
    : { actorId: context.principalId };
}

export function containedMutationForTool(toolName: string, args: unknown): ContainedMutation | undefined {
  if (toolName === 'sangfor.apply_approved_product_change') return 'product_change';
  if (toolName === 'sangfor.execute_console_action_live') return 'live_device';
  if (toolName === 'sangfor.apply_wiki_update'
    || toolName === 'sangfor.apply_obsidian_wiki_update'
    || toolName === 'sangfor.apply_github_wiki_update') {
    return 'wiki_sync';
  }
  if (toolName !== 'sangfor.execute_console_action' || !isRecord(args)) return undefined;
  const action = args.action;
  return isRecord(action) && action.dryRun === false ? 'live_device' : undefined;
}

export function denyContainedMutation(_mutation: ContainedMutation): Readonly<{
  allowed: false;
  code: typeof MUTATION_CONTAINED_BY_U002;
}> {
  return { allowed: false, code: MUTATION_CONTAINED_BY_U002 };
}

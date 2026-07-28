import { createHash } from 'node:crypto';
import { ENGINEER_INTERNAL_PRINCIPAL_PATH, issueEngineerInternalPrincipal, parseEngineerInternalPrincipalConfig, type EngineerPrincipalScope } from './internal-principal-client.js';

export interface PlannedExternalAction extends EngineerPrincipalScope { readonly receipt: string; readonly action: string; readonly target: string; readonly bodyHash: string; readonly idempotencyKey: string; }
export class ExternalActionReleaseClientError extends Error { constructor(readonly code: string) { super(code); } }
const hash = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** Consume at root then compare every non-secret returned claim before a caller may invoke an executor. */
export async function consumePlannedExternalAction(plan: PlannedExternalAction, fetcher: typeof fetch = fetch): Promise<Record<string, unknown>> {
  if (!plan.receipt || !plan.action || !plan.target || !/^[a-f0-9]{64}$/.test(plan.bodyHash) || !plan.idempotencyKey) throw new ExternalActionReleaseClientError('EXTERNAL_ACTION_RELEASE_REQUIRED');
  const config = parseEngineerInternalPrincipalConfig(); const raw = JSON.stringify({ receipt: plan.receipt });
  const principal = issueEngineerInternalPrincipal({ ...plan, method: 'POST', path: ENGINEER_INTERNAL_PRINCIPAL_PATH, query: '', body: raw }, config);
  const response = await fetcher(`${config.rootUrl}${ENGINEER_INTERNAL_PRINCIPAL_PATH}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-sangfor-internal-principal': principal }, body: raw });
  let decoded: unknown; try { decoded = await response.json(); } catch { throw new ExternalActionReleaseClientError('UNKNOWN_EXTERNAL_RESULT'); }
  if (!response.ok || !record(decoded) || !record(decoded.claims)) throw new ExternalActionReleaseClientError(record(decoded) && typeof decoded.error === 'string' ? decoded.error : 'UNKNOWN_EXTERNAL_RESULT');
  const claims = decoded.claims;
  if (claims.action !== plan.action || claims.target !== plan.target || claims.bodyHash !== plan.bodyHash || claims.idempotencyKey !== plan.idempotencyKey || claims.tenantId !== plan.tenantId || claims.companyId !== plan.companyId || claims.projectId !== plan.projectId) throw new ExternalActionReleaseClientError('EXTERNAL_ACTION_CLAIMS_MISMATCH');
  return claims;
}
function canonical(value: unknown): string {
  if (value === null || typeof value === 'boolean') return String(value);
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') { if (!Number.isFinite(value)) throw new ExternalActionReleaseClientError('INVALID_CANONICAL_OPERATION'); return String(value); }
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value as Record<string, unknown>).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
  throw new ExternalActionReleaseClientError('INVALID_CANONICAL_OPERATION');
}
export function externalActionBodyHash(operation: unknown): string { return hash(canonical(operation)); }

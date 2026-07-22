/** U026 durable replay authority — intentionally delegates to U021's DB chain, never memory. */
import { Prisma, prisma } from '@sangfor/db';
import { appendAuditEvent } from './audit-db';

export interface InternalPrincipalReplayInput {
  readonly profile: 'FINANCE' | 'SCHEDULER' | 'WORKFLOW' | 'ENGINEER';
  readonly subjectId: string;
  readonly tenantId: string;
  readonly companyId: string;
  readonly projectId: string;
  readonly jti: string;
  readonly nonce: string;
  readonly idempotencyKey: string;
}

export interface InternalPrincipalReplayClaimed {
  readonly claimed: true;
  readonly auditEventIds: readonly string[];
}

export class InternalPrincipalReplayError extends Error {
  constructor(message: string) {
    super(`internal principal replay rejected: ${message}`);
    this.name = 'InternalPrincipalReplayError';
  }
}

type ReplayDatabase = {
  $transaction<T>(callback: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T>;
};

function assertIdentifier(name: string, value: string): void {
  if (typeof value !== 'string' || value.length === 0 || value.length > 255) {
    throw new InternalPrincipalReplayError(`${name} is required`);
  }
}

/**
 * Claims every independent replay handle in one U021 transaction. If any of
 * jti/nonce/idempotency was used, the throw rolls back the other two claims,
 * so a malformed repeat cannot poison a future legitimate request.
 */
export async function claimInternalPrincipalReplay(
  input: InternalPrincipalReplayInput,
  database: ReplayDatabase = prisma,
): Promise<InternalPrincipalReplayClaimed> {
  for (const [name, value] of Object.entries(input)) assertIdentifier(name, value);
  const scope = { tenantId: input.tenantId, companyId: input.companyId, projectId: input.projectId, level: 'PROJECT' as const };
  const claims = [
    ['jti', input.jti],
    ['nonce', input.nonce],
    ['idempotency', input.idempotencyKey],
  ] as const;
  return database.$transaction(async (tx) => {
    const eventIds: string[] = [];
    for (const [kind, value] of claims) {
      const appended = await appendAuditEvent(tx, {
        scope,
        eventType: 'internal_principal.claim',
        actorId: input.subjectId,
        resourceType: 'internal_principal',
        resourceId: input.jti,
        // No signature, protected header, or key material is ever audited.
        details: { protocol: 'sangfor.internal-principal/v1', profile: input.profile, claim: kind },
        idempotencyKey: `internal-principal/v1:${kind}:${value}`,
      });
      if (appended.idempotent) throw new InternalPrincipalReplayError(`${kind} was already claimed`);
      eventIds.push(appended.id);
    }
    return { claimed: true, auditEventIds: eventIds };
  });
}

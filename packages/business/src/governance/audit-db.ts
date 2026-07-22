import { Prisma, prisma } from '@sangfor/db'

import {
  AUDIT_CHAIN_ZERO_HASH,
  AuditChain,
  AuditChainError,
  buildAuditChainEnvelope,
  computeAuditChainEventHash,
  deriveChainScopeKey,
  formatOccurredAt,
  type AuditChainScope,
} from './audit-chain'

type TxClient = Prisma.TransactionClient

export interface AppendAuditEventInput {
  scope: AuditChainScope
  eventType: string
  actorId: string | null
  resourceType: string
  resourceId: string | null
  details?: unknown
  idempotencyKey?: string | null
  occurredAt?: Date
}

export interface AppendedAuditEvent {
  id: string
  chainScopeKey: string
  sequence: number
  eventHash: string
  previousHash: string
  idempotent: boolean
}

const IDEMPOTENCY_UNIQUE_CONSTRAINT = 'audit_logs_chain_scope_key_idempotency_key_key'

function toPrismaJson(details: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (details === null || details === undefined) return Prisma.JsonNull
  return JSON.parse(JSON.stringify(details)) as Prisma.InputJsonValue
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === 'P2002'
  )
}

/**
 * Appends one audit event inside the CALLER's own transaction client, so a domain mutation and its
 * audit append commit or roll back together (U021 contract point 2). Serializes concurrent appends
 * to the SAME `chainScopeKey` with `pg_advisory_xact_lock(hashtextextended(chainScopeKey, 0))` —
 * NOT a lockable audit-head row — held for the remainder of `tx`'s transaction. A caller-supplied
 * `idempotencyKey` that already has a row for this `chainScopeKey` returns that original row
 * (never a second insert); a same-key race that still reaches a unique-constraint violation (e.g. a
 * caller that reused a key across an already-committed, different transaction) resolves the same
 * way rather than surfacing the raw DB error.
 */
export async function appendAuditEvent(tx: TxClient, input: AppendAuditEventInput): Promise<AppendedAuditEvent> {
  const chainScopeKey = deriveChainScopeKey(input.scope)

  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${chainScopeKey}, 0))`

  if (input.idempotencyKey) {
    const existing = await tx.auditLog.findFirst({ where: { chainScopeKey, idempotencyKey: input.idempotencyKey } })
    if (existing) return toAppendedEvent(existing, true)
  }

  const last = await tx.auditLog.findFirst({
    where: { chainScopeKey },
    orderBy: { sequence: 'desc' },
    select: { sequence: true, eventHash: true },
  })
  const sequence = (last?.sequence ?? 0) + 1
  const previousHash = last?.eventHash ?? AUDIT_CHAIN_ZERO_HASH

  const occurredAtDate = input.occurredAt ?? new Date()
  const details = input.details ?? null

  const envelope = buildAuditChainEnvelope({
    actorId: input.actorId,
    chainScopeKey,
    details,
    eventType: input.eventType,
    occurredAt: formatOccurredAt(occurredAtDate),
    previousHash,
    resourceId: input.resourceId,
    resourceType: input.resourceType,
    scope: input.scope,
    sequence,
  })
  const eventHash = computeAuditChainEventHash(envelope)

  try {
    const created = await tx.auditLog.create({
      data: {
        tenantId: input.scope.tenantId,
        scopeLevel: input.scope.level,
        companyId: input.scope.companyId,
        projectId: input.scope.projectId,
        chainScopeKey,
        sequence,
        eventType: input.eventType,
        actorId: input.actorId,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        details: toPrismaJson(details),
        previousHash,
        eventHash,
        idempotencyKey: input.idempotencyKey ?? null,
        timestamp: occurredAtDate,
      },
      select: { id: true, chainScopeKey: true, sequence: true, eventHash: true, previousHash: true },
    })
    return toAppendedEvent(created, false)
  } catch (err) {
    if (input.idempotencyKey && isUniqueViolation(err)) {
      const existing = await tx.auditLog.findFirst({ where: { chainScopeKey, idempotencyKey: input.idempotencyKey } })
      if (existing) return toAppendedEvent(existing, true)
    }
    throw err
  }
}

function toAppendedEvent(row: { id: string; chainScopeKey: string; sequence: number; eventHash: string; previousHash: string }, idempotent: boolean): AppendedAuditEvent {
  return { id: row.id, chainScopeKey: row.chainScopeKey, sequence: row.sequence, eventHash: row.eventHash, previousHash: row.previousHash, idempotent }
}

/** Non-transactional convenience wrapper — opens its own transaction (U021 contract point 2: "a
 * non-transactional wrapper may open a transaction"). Prefer `appendAuditEvent(tx, input)` from
 * inside a domain service's existing transaction whenever one exists. */
export async function appendAuditEventStandalone(input: AppendAuditEventInput): Promise<AppendedAuditEvent> {
  return prisma.$transaction((tx) => appendAuditEvent(tx, input))
}

const DEFAULT_LEGACY_TENANT_ID = process.env.DEFAULT_TENANT_ID ?? 'dev-tenant'

/**
 * @deprecated pre-U021 signature, kept call-compatible ONLY for `infrastructure/module-admin.ts`
 * and `apps/web`'s `modules/actions.ts` — both out of this unit's file boundary and both call
 * sites for a genuinely tenant-less system/admin action (module registry toggles), so there is no
 * `AuthContext` to source scope from at all. This shim attributes those events to
 * `DEFAULT_TENANT_ID`/`dev-tenant` — the SAME env-gated fallback identifier
 * `apps/api/src/middleware/auth.ts`/`packages/auth/src/auth-context.ts` already use for a
 * dev/test-only default scope, reused here rather than invented — as a documented compatibility
 * affordance, not silent scope invention: if that tenant does not exist in the target database the
 * FK constraint fails closed (no audit event is fabricated without a real backing tenant). New
 * callers with a real `AuthContext` MUST use `appendAuditEvent`/`appendAuditEventStandalone`
 * instead.
 */
export async function recordAuditEvent(
  eventType: string,
  actorId: string,
  resourceType: string,
  resourceId: string,
  details: Record<string, unknown> = {},
): Promise<AppendedAuditEvent> {
  return appendAuditEventStandalone({
    scope: { tenantId: DEFAULT_LEGACY_TENANT_ID, companyId: null, projectId: null, level: 'TENANT' },
    eventType,
    actorId,
    resourceType,
    resourceId,
    details,
  })
}

/**
 * @deprecated pre-U021 global-chain verifier. Reads the WHOLE `audit_logs` table ordered by
 * `timestamp` (never scope-partitioned, never `sequence`-ordered) and checks it against the
 * long-superseded `AuditChain.computeHash` shape — retained only for `verifyPersistedAuditLogs`'s
 * existing callers/tests. Use `verifyAuditChainRows` (from `./audit-chain`) against real persisted
 * rows for the U021 canonical, scope-partitioned verification.
 */
export async function verifyAuditIntegrity(): Promise<boolean> {
  const logs = await prisma.auditLog.findMany({ orderBy: { timestamp: 'asc' } })
  return verifyPersistedAuditLogs(logs)
}

interface LegacyPersistedAuditLog {
  eventType: string
  actorId: string | null
  resourceType: string
  resourceId: string | null
  details: unknown
  previousHash: string | null
  eventHash: string | null
  timestamp: Date
}

/** @deprecated see the `verifyAuditIntegrity` doc comment above. */
export function verifyPersistedAuditLogs(logs: LegacyPersistedAuditLog[]): boolean {
  let previousHash = AUDIT_CHAIN_ZERO_HASH
  for (const log of logs) {
    if (!log.eventHash || log.previousHash !== previousHash) {
      return false
    }

    const expectedHash = AuditChain.computeHash(
      log.eventType,
      log.actorId ?? '',
      log.resourceType,
      log.resourceId ?? '',
      toAuditDetails(log.details),
      log.timestamp.toISOString(),
      previousHash,
    )
    if (log.eventHash !== expectedHash) return false
    previousHash = log.eventHash
  }
  return true
}

function toAuditDetails(details: unknown): Record<string, unknown> {
  if (details && typeof details === 'object' && !Array.isArray(details)) {
    return details as Record<string, unknown>
  }
  return {}
}

// Re-exported so callers that only import from `audit-db` (the pre-U021 entrypoint) can reach the
// U021 error type without a second import path.
export { AuditChainError }

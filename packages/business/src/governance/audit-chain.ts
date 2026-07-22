import { createHash } from 'crypto'

import { canonicalizeRfc8785 } from '@sangfor/db'

export const AUDIT_CHAIN_ZERO_HASH = '0'.repeat(64)

/**
 * @deprecated pre-U021 in-memory chain shape. `audit-db.ts` no longer uses this as authority for
 * any persisted row (U021 contract point 8 forbids an in-memory chain as authority) — kept only so
 * pre-U021 callers/tests of `AuditChain`/`verifyPersistedAuditLogs` keep compiling and passing. The
 * U021 canonical DB-backed chain is `buildAuditChainEnvelope`/`verifyAuditChainRows` below.
 */
export interface AuditEvent {
  id: string
  previousHash: string
  eventType: string
  actorId: string
  resourceType: string
  resourceId: string
  details: Record<string, unknown>
  timestamp: string
  hash: string
}

/** @deprecated see the module doc comment on `AuditEvent` above. */
export class AuditChain {
  private events: AuditEvent[] = []
  private lastHash = AUDIT_CHAIN_ZERO_HASH

  record(eventType: string, actorId: string, resourceType: string, resourceId: string, details: Record<string, unknown> = {}): AuditEvent {
    const event = AuditChain.createEvent(eventType, actorId, resourceType, resourceId, details, this.lastHash, this.events.length + 1)
    this.events.push(event)
    this.lastHash = event.hash
    return event
  }

  getEvents(): AuditEvent[] { return [...this.events] }
  getLastHash(): string { return this.lastHash }

  static createEvent(
    eventType: string,
    actorId: string,
    resourceType: string,
    resourceId: string,
    details: Record<string, unknown> = {},
    previousHash: string = AUDIT_CHAIN_ZERO_HASH,
    sequence = 1,
  ): AuditEvent {
    const timestamp = new Date().toISOString()
    const hash = AuditChain.computeHash(eventType, actorId, resourceType, resourceId, details, timestamp, previousHash)
    return {
      id: `audit-${sequence}-${Date.now()}`,
      previousHash,
      eventType, actorId, resourceType, resourceId, details, timestamp, hash,
    }
  }

  static computeHash(
    eventType: string,
    actorId: string,
    resourceType: string,
    resourceId: string,
    details: Record<string, unknown>,
    timestamp: string,
    previousHash: string,
  ): string {
    const canonicalJson = stableStringify({ eventType, actorId, resourceType, resourceId, details, timestamp, previousHash })
    return createHash('sha256').update(canonicalJson).digest('hex')
  }

  verifyIntegrity(): boolean {
    let hash = '0'.repeat(64)
    for (const event of this.events) {
      const expectedHash = AuditChain.computeHash(event.eventType, event.actorId, event.resourceType, event.resourceId, event.details, event.timestamp, hash)
      if (event.hash !== expectedHash || event.previousHash !== hash) return false
      hash = event.hash
    }
    return true
  }
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortForStableJson(value))
}

function sortForStableJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortForStableJson)
  }

  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, sortForStableJson(entry)]),
    )
  }

  return value
}

// ─────────────────────────────────────────────────────────────────────────
// U021/AUD-01b: scoped, versioned, hash-chained audit envelope — the sole canonical producer AND
// verifier of the sangfor.audit-chain/v1 byte schema. Reuses U017's tested RFC 8785 JCS
// canonicalizer (`canonicalizeRfc8785` from `@sangfor/db`) exclusively — never `JSON.stringify`,
// never a locale-aware sort, never PostgreSQL `jsonb::text`. `packages/db`'s migration
// 20260715210000 installs the byte-identical PostgreSQL parity functions
// (sangfor_rfc8785_jcs_v1/sangfor_sha256_utf8) that independently re-verify every row this module
// builds, at INSERT time, from the row's own persisted columns.
// ─────────────────────────────────────────────────────────────────────────

export const AUDIT_CHAIN_VERSION = 'sangfor.audit-chain/v1' as const

export type AuditScopeLevel = 'TENANT' | 'COMPANY' | 'PROJECT'

export interface AuditChainScope {
  tenantId: string
  companyId: string | null
  projectId: string | null
  level: AuditScopeLevel
}

export interface AuditChainEnvelopeInput {
  actorId: string | null
  chainScopeKey: string
  details: unknown
  eventType: string
  /** UTC RFC3339 with exactly six fractional digits: YYYY-MM-DDTHH:mm:ss.ffffffZ. */
  occurredAt: string
  /** 64 lowercase hex characters. */
  previousHash: string
  resourceId: string | null
  resourceType: string
  scope: AuditChainScope
  /** Positive per-chain (chainScopeKey) counter. */
  sequence: number
}

export interface AuditChainEnvelope extends AuditChainEnvelopeInput {
  version: typeof AUDIT_CHAIN_VERSION
}

export type AuditChainErrorCode =
  | 'INVALID_OCCURRED_AT'
  | 'INVALID_HASH_FORMAT'
  | 'INVALID_SEQUENCE'
  | 'SCOPE_KEY_MISMATCH'
  | 'MISSING_GENESIS'
  | 'UNKNOWN_SCOPE_LEVEL'
  | 'INVALID_SCOPE_NULLABILITY'

export class AuditChainError extends Error {
  code: AuditChainErrorCode
  constructor(code: AuditChainErrorCode, message: string) {
    super(message)
    this.name = 'AuditChainError'
    this.code = code
  }
}

const OCCURRED_AT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/
const HASH_PATTERN = /^[0-9a-f]{64}$/

/** The persisted `timestamp` rendered as UTC RFC3339 with exactly six fractional digits — the
 * exact string PostgreSQL's `to_char(ts AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`
 * produces, so a JS-computed occurredAt and the DB's own re-derivation from the stored column are
 * byte-identical (never a timestamp shortcut / millisecond-only string). */
export function formatOccurredAt(date: Date): string {
  const iso = date.toISOString()
  return `${iso.slice(0, -1)}000Z`
}

/** `tenant:<tenantId>` | `company:<tenantId>:<companyId>` | `project:<tenantId>:<companyId>:<projectId>` — the exact chainScopeKey derivation, mirrored byte-for-byte by the
 * `sangfor_audit_logs_scope_guard_trg` trigger (migration 20260715210000). Throws on an
 * inconsistent nullability matrix (never hashes across unrelated tenant/company scopes). */
export function deriveChainScopeKey(scope: AuditChainScope): string {
  if (scope.level === 'TENANT') {
    if (scope.companyId !== null || scope.projectId !== null) {
      throw new AuditChainError('INVALID_SCOPE_NULLABILITY', 'TENANT scope requires companyId and projectId both null')
    }
    return `tenant:${scope.tenantId}`
  }
  if (scope.level === 'COMPANY') {
    if (scope.companyId === null || scope.projectId !== null) {
      throw new AuditChainError('INVALID_SCOPE_NULLABILITY', 'COMPANY scope requires companyId set and projectId null')
    }
    return `company:${scope.tenantId}:${scope.companyId}`
  }
  if (scope.level === 'PROJECT') {
    if (scope.companyId === null || scope.projectId === null) {
      throw new AuditChainError('INVALID_SCOPE_NULLABILITY', 'PROJECT scope requires companyId and projectId both set')
    }
    return `project:${scope.tenantId}:${scope.companyId}:${scope.projectId}`
  }
  throw new AuditChainError('UNKNOWN_SCOPE_LEVEL', `unknown scope level ${String(scope.level)}`)
}

/** Constructs and validates the exact `sangfor.audit-chain/v1` envelope. `version` is never a
 * caller input — always the fixed literal, so a caller cannot inject an unknown version. */
export function buildAuditChainEnvelope(input: AuditChainEnvelopeInput): AuditChainEnvelope {
  if (!OCCURRED_AT_PATTERN.test(input.occurredAt)) {
    throw new AuditChainError('INVALID_OCCURRED_AT', `occurredAt must be an exact UTC RFC3339 string with six fractional digits (YYYY-MM-DDTHH:mm:ss.ffffffZ), got ${JSON.stringify(input.occurredAt)}`)
  }
  if (!HASH_PATTERN.test(input.previousHash)) {
    throw new AuditChainError('INVALID_HASH_FORMAT', `previousHash must be exactly 64 lowercase hex characters, got ${JSON.stringify(input.previousHash)}`)
  }
  if (!Number.isInteger(input.sequence) || input.sequence < 1) {
    throw new AuditChainError('INVALID_SEQUENCE', `sequence must be a positive integer, got ${input.sequence}`)
  }
  const expectedKey = deriveChainScopeKey(input.scope)
  if (input.chainScopeKey !== expectedKey) {
    throw new AuditChainError('SCOPE_KEY_MISMATCH', `chainScopeKey ${JSON.stringify(input.chainScopeKey)} does not match the key derived from scope: ${JSON.stringify(expectedKey)}`)
  }
  if (input.sequence === 1 && input.previousHash !== AUDIT_CHAIN_ZERO_HASH) {
    throw new AuditChainError('MISSING_GENESIS', 'sequence=1 (genesis) requires previousHash to be exactly 64 zeroes')
  }

  return { ...input, version: AUDIT_CHAIN_VERSION }
}

/** Reconstructs exactly this fixed field set (never `...envelope` spread) so a caller-supplied
 * extra property on the envelope object can never leak into the hashed bytes. RFC 8785 JCS sorts
 * object member names itself, so the property order below is for readability only. */
export function canonicalizeAuditChainEnvelope(envelope: AuditChainEnvelope): string {
  const value = {
    actorId: envelope.actorId,
    chainScopeKey: envelope.chainScopeKey,
    details: envelope.details ?? null,
    eventType: envelope.eventType,
    occurredAt: envelope.occurredAt,
    previousHash: envelope.previousHash,
    resourceId: envelope.resourceId,
    resourceType: envelope.resourceType,
    scope: {
      companyId: envelope.scope.companyId,
      level: envelope.scope.level,
      projectId: envelope.scope.projectId,
      tenantId: envelope.scope.tenantId,
    },
    sequence: envelope.sequence,
    version: envelope.version,
  }
  return canonicalizeRfc8785(value)
}

export function computeAuditChainEventHash(envelope: AuditChainEnvelope): string {
  const bytes = new TextEncoder().encode(canonicalizeAuditChainEnvelope(envelope))
  return createHash('sha256').update(bytes).digest('hex')
}

/** One persisted `audit_logs` row, in the shape needed to independently re-verify it — the same
 * fields `computeAuditChainEventHash` hashes, plus the stored hashes to compare against. */
export interface PersistedAuditChainRow {
  chainScopeKey: string
  sequence: number
  scope: AuditChainScope
  eventType: string
  actorId: string | null
  resourceType: string
  resourceId: string | null
  details: unknown
  previousHash: string
  eventHash: string
  occurredAt: string
}

export type AuditChainVerificationErrorCode =
  | 'DUPLICATE_SEQUENCE'
  | 'NON_CONTIGUOUS_SEQUENCE'
  | 'MISSING_GENESIS'
  | 'PREDECESSOR_MISMATCH'
  | 'HASH_MISMATCH'

export interface AuditChainVerificationError {
  chainScopeKey: string
  sequence: number
  code: AuditChainVerificationErrorCode
  message: string
}

export interface AuditChainVerificationResult {
  ok: boolean
  chains: number
  rows: number
  errors: AuditChainVerificationError[]
}

/** Independently reconstructs every row's exact bytes, partitions by `chainScopeKey`, and orders
 * by `sequence` — NEVER by timestamp (U021 contract point 3). Detects: duplicate/non-contiguous
 * sequences, a missing/wrong genesis, a predecessor-hash mismatch, and any digest drift (tampering,
 * wrong version, wrong byte encoding, or any other corruption of a single copy). */
export function verifyAuditChainRows(rows: PersistedAuditChainRow[]): AuditChainVerificationResult {
  const errors: AuditChainVerificationError[] = []
  const byScope = new Map<string, PersistedAuditChainRow[]>()
  for (const row of rows) {
    const list = byScope.get(row.chainScopeKey) ?? []
    list.push(row)
    byScope.set(row.chainScopeKey, list)
  }

  for (const [chainScopeKey, chainRows] of byScope) {
    const ordered = [...chainRows].sort((a, b) => a.sequence - b.sequence)
    let previousHash = AUDIT_CHAIN_ZERO_HASH
    let expectedSequence = 1
    const seenSequences = new Set<number>()

    for (const row of ordered) {
      if (seenSequences.has(row.sequence)) {
        errors.push({ chainScopeKey, sequence: row.sequence, code: 'DUPLICATE_SEQUENCE', message: `duplicate sequence ${row.sequence}` })
        continue
      }
      seenSequences.add(row.sequence)

      if (row.sequence !== expectedSequence) {
        errors.push({ chainScopeKey, sequence: row.sequence, code: 'NON_CONTIGUOUS_SEQUENCE', message: `expected sequence ${expectedSequence}, got ${row.sequence}` })
      }

      if (row.previousHash !== previousHash) {
        errors.push({
          chainScopeKey,
          sequence: row.sequence,
          code: row.sequence === 1 ? 'MISSING_GENESIS' : 'PREDECESSOR_MISMATCH',
          message: `previousHash ${row.previousHash} does not equal the expected predecessor hash ${previousHash}`,
        })
      }

      const envelope: AuditChainEnvelope = {
        actorId: row.actorId,
        chainScopeKey: row.chainScopeKey,
        details: row.details,
        eventType: row.eventType,
        occurredAt: row.occurredAt,
        previousHash: row.previousHash,
        resourceId: row.resourceId,
        resourceType: row.resourceType,
        scope: row.scope,
        sequence: row.sequence,
        version: AUDIT_CHAIN_VERSION,
      }
      const recomputedHash = computeAuditChainEventHash(envelope)
      if (recomputedHash !== row.eventHash) {
        errors.push({ chainScopeKey, sequence: row.sequence, code: 'HASH_MISMATCH', message: `eventHash ${row.eventHash} does not equal the recomputed digest ${recomputedHash}` })
      }

      previousHash = row.eventHash
      expectedSequence += 1
    }
  }

  return { ok: errors.length === 0, chains: byScope.size, rows: rows.length, errors }
}

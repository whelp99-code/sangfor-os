import { createHash } from 'crypto'

import { describe, expect, it } from 'vitest'

import {
  AUDIT_CHAIN_VERSION,
  AUDIT_CHAIN_ZERO_HASH,
  AuditChainError,
  buildAuditChainEnvelope,
  canonicalizeAuditChainEnvelope,
  computeAuditChainEventHash,
  deriveChainScopeKey,
  formatOccurredAt,
  verifyAuditChainRows,
  type AuditChainEnvelope,
  type AuditChainScope,
  type PersistedAuditChainRow,
} from './audit-chain'

const PROJECT_SCOPE: AuditChainScope = { tenantId: 't1', companyId: 'c1', projectId: 'p1', level: 'PROJECT' }

function baseInput() {
  return {
    actorId: 'user-1',
    chainScopeKey: 'project:t1:c1:p1',
    details: { amount: 100, currency: 'USD' },
    eventType: 'quote.created',
    occurredAt: '2026-01-01T00:00:00.000000Z',
    previousHash: AUDIT_CHAIN_ZERO_HASH,
    resourceId: 'quote-1',
    resourceType: 'quote',
    scope: PROJECT_SCOPE,
    sequence: 1,
  }
}

describe('deriveChainScopeKey', () => {
  it('derives tenant:<tenantId> for TENANT scope', () => {
    expect(deriveChainScopeKey({ tenantId: 't1', companyId: null, projectId: null, level: 'TENANT' })).toBe('tenant:t1')
  })

  it('derives company:<tenantId>:<companyId> for COMPANY scope', () => {
    expect(deriveChainScopeKey({ tenantId: 't1', companyId: 'c1', projectId: null, level: 'COMPANY' })).toBe('company:t1:c1')
  })

  it('derives project:<tenantId>:<companyId>:<projectId> for PROJECT scope', () => {
    expect(deriveChainScopeKey(PROJECT_SCOPE)).toBe('project:t1:c1:p1')
  })

  it('rejects TENANT scope carrying a companyId or projectId', () => {
    expect(() => deriveChainScopeKey({ tenantId: 't1', companyId: 'c1', projectId: null, level: 'TENANT' })).toThrow(AuditChainError)
    expect(() => deriveChainScopeKey({ tenantId: 't1', companyId: null, projectId: 'p1', level: 'TENANT' })).toThrow(AuditChainError)
  })

  it('rejects COMPANY scope missing companyId or carrying a projectId', () => {
    expect(() => deriveChainScopeKey({ tenantId: 't1', companyId: null, projectId: null, level: 'COMPANY' })).toThrow(AuditChainError)
    expect(() => deriveChainScopeKey({ tenantId: 't1', companyId: 'c1', projectId: 'p1', level: 'COMPANY' })).toThrow(AuditChainError)
  })

  it('rejects PROJECT scope missing companyId or projectId', () => {
    expect(() => deriveChainScopeKey({ tenantId: 't1', companyId: null, projectId: 'p1', level: 'PROJECT' })).toThrow(AuditChainError)
    expect(() => deriveChainScopeKey({ tenantId: 't1', companyId: 'c1', projectId: null, level: 'PROJECT' })).toThrow(AuditChainError)
  })
})

describe('formatOccurredAt', () => {
  it('renders exactly six fractional digits with trailing zeros for millisecond-precision input', () => {
    expect(formatOccurredAt(new Date('2026-01-01T00:00:00.123Z'))).toBe('2026-01-01T00:00:00.123000Z')
  })
})

describe('buildAuditChainEnvelope — validation', () => {
  it('builds the envelope with the fixed version literal attached', () => {
    const envelope = buildAuditChainEnvelope(baseInput())
    expect(envelope.version).toBe('sangfor.audit-chain/v1')
    expect(envelope.version).toBe(AUDIT_CHAIN_VERSION)
  })

  it.each([
    '2026-01-01T00:00:00Z',
    '2026-01-01T00:00:00.123Z',
    '2026-01-01T00:00:00.1234567Z',
    '2026-01-01 00:00:00.000000Z',
    '2026-01-01T00:00:00.000000+09:00',
    '2026-01-01T00:00:00.000000',
  ])('rejects a timestamp shortcut/non-UTC/wrong-precision occurredAt: %s', (occurredAt) => {
    expect(() => buildAuditChainEnvelope({ ...baseInput(), occurredAt })).toThrow(AuditChainError)
  })

  it('rejects an uppercase previousHash', () => {
    const uppercaseHash = 'AB'.repeat(32)
    expect(() => buildAuditChainEnvelope({ ...baseInput(), sequence: 2, previousHash: uppercaseHash })).toThrow(AuditChainError)
  })

  it('rejects a previousHash that is not exactly 64 hex characters', () => {
    expect(() => buildAuditChainEnvelope({ ...baseInput(), previousHash: 'ab'.repeat(31) })).toThrow(AuditChainError)
  })

  it('rejects a non-positive or non-integer sequence', () => {
    expect(() => buildAuditChainEnvelope({ ...baseInput(), sequence: 0 })).toThrow(AuditChainError)
    expect(() => buildAuditChainEnvelope({ ...baseInput(), sequence: -1 })).toThrow(AuditChainError)
    expect(() => buildAuditChainEnvelope({ ...baseInput(), sequence: 1.5 })).toThrow(AuditChainError)
  })

  it('rejects a null (non-zero) genesis previousHash at sequence 1', () => {
    expect(() => buildAuditChainEnvelope({ ...baseInput(), sequence: 1, previousHash: 'a'.repeat(64) })).toThrow(AuditChainError)
  })

  it('rejects a chainScopeKey that does not match the derived key for the given scope', () => {
    expect(() => buildAuditChainEnvelope({ ...baseInput(), chainScopeKey: 'project:t1:c1:wrong-project' })).toThrow(AuditChainError)
  })
})

describe('canonicalizeAuditChainEnvelope — exact byte vector', () => {
  const envelope = buildAuditChainEnvelope(baseInput())

  it('produces the exact expected RFC 8785 JCS byte string (sorted keys, no whitespace)', () => {
    const expected =
      '{"actorId":"user-1","chainScopeKey":"project:t1:c1:p1","details":{"amount":100,"currency":"USD"},' +
      '"eventType":"quote.created","occurredAt":"2026-01-01T00:00:00.000000Z",' +
      `"previousHash":"${AUDIT_CHAIN_ZERO_HASH}","resourceId":"quote-1","resourceType":"quote",` +
      '"scope":{"companyId":"c1","level":"PROJECT","projectId":"p1","tenantId":"t1"},"sequence":1,' +
      '"version":"sangfor.audit-chain/v1"}'
    expect(canonicalizeAuditChainEnvelope(envelope)).toBe(expected)
  })

  it('is independent of the JS object construction order (never relies on JSON.stringify insertion order)', () => {
    const reordered: AuditChainEnvelope = {
      version: envelope.version,
      sequence: envelope.sequence,
      scope: { tenantId: envelope.scope.tenantId, projectId: envelope.scope.projectId, companyId: envelope.scope.companyId, level: envelope.scope.level },
      resourceType: envelope.resourceType,
      resourceId: envelope.resourceId,
      previousHash: envelope.previousHash,
      occurredAt: envelope.occurredAt,
      eventType: envelope.eventType,
      details: envelope.details,
      chainScopeKey: envelope.chainScopeKey,
      actorId: envelope.actorId,
    }
    expect(canonicalizeAuditChainEnvelope(reordered)).toBe(canonicalizeAuditChainEnvelope(envelope))
  })

  it('differs from naive JSON.stringify (proving JSON.stringify byte output is rejected, not silently accepted)', () => {
    expect(canonicalizeAuditChainEnvelope(envelope)).not.toBe(JSON.stringify(envelope))
  })

  it('ignores an extra property spread onto the envelope object (never leaks into the hashed bytes)', () => {
    const tampered = { ...envelope, unexpectedExtraField: 'should not appear' } as AuditChainEnvelope
    expect(canonicalizeAuditChainEnvelope(tampered)).toBe(canonicalizeAuditChainEnvelope(envelope))
  })
})

describe('computeAuditChainEventHash — exact digest vector', () => {
  it('equals lowercase hex SHA-256 of the UTF-8 bytes of the canonical envelope, independently recomputed', () => {
    const envelope = buildAuditChainEnvelope(baseInput())
    const canonical = canonicalizeAuditChainEnvelope(envelope)
    const independentDigest = createHash('sha256').update(Buffer.from(canonical, 'utf8')).digest('hex')
    expect(computeAuditChainEventHash(envelope)).toBe(independentDigest)
    expect(computeAuditChainEventHash(envelope)).toMatch(/^[0-9a-f]{64}$/)
  })

  it('changes when the version literal changes (version is part of the hashed bytes, not decorative)', () => {
    const envelope = buildAuditChainEnvelope(baseInput())
    const tamperedVersionEnvelope = { ...envelope, version: 'sangfor.audit-chain/v2' } as unknown as AuditChainEnvelope
    expect(computeAuditChainEventHash(tamperedVersionEnvelope)).not.toBe(computeAuditChainEventHash(envelope))
  })

  it('changes when details is JSON.stringify-serialized instead of RFC8785-canonicalized (byte format matters, not just logical equality)', () => {
    const envelope = buildAuditChainEnvelope(baseInput())
    const naiveBytes = new TextEncoder().encode(JSON.stringify(envelope))
    const naiveDigest = createHash('sha256').update(naiveBytes).digest('hex')
    expect(naiveDigest).not.toBe(computeAuditChainEventHash(envelope))
  })
})

function makeRow(overrides: Partial<PersistedAuditChainRow> & Pick<PersistedAuditChainRow, 'chainScopeKey' | 'scope' | 'sequence' | 'previousHash'>): PersistedAuditChainRow {
  const row: PersistedAuditChainRow = {
    eventType: 'demo.event',
    actorId: 'user-1',
    resourceType: 'demo',
    resourceId: 'res-1',
    details: null,
    occurredAt: formatOccurredAt(new Date(Date.UTC(2026, 0, 1, 0, 0, overrides.sequence))),
    eventHash: '',
    ...overrides,
  }
  const envelope = buildAuditChainEnvelope({ ...row, chainScopeKey: row.chainScopeKey })
  row.eventHash = computeAuditChainEventHash(envelope)
  return row
}

function buildValidChain(chainScopeKey: string, scope: AuditChainScope, length: number): PersistedAuditChainRow[] {
  const rows: PersistedAuditChainRow[] = []
  let previousHash = AUDIT_CHAIN_ZERO_HASH
  for (let sequence = 1; sequence <= length; sequence += 1) {
    const row = makeRow({ chainScopeKey, scope, sequence, previousHash })
    rows.push(row)
    previousHash = row.eventHash
  }
  return rows
}

describe('verifyAuditChainRows', () => {
  it('accepts a valid 32-row single-scope chain as unique, contiguous, and hash-valid', () => {
    const rows = buildValidChain('project:t1:c1:p1', PROJECT_SCOPE, 32)
    const result = verifyAuditChainRows(rows)
    expect(result.ok).toBe(true)
    expect(result.chains).toBe(1)
    expect(result.rows).toBe(32)
    expect(new Set(rows.map((r) => r.sequence)).size).toBe(32)
    expect(result.errors).toEqual([])
  })

  it('gives two independent scopes each their own 64-zero genesis, ordered by sequence within each', () => {
    const scopeA: AuditChainScope = { tenantId: 't1', companyId: null, projectId: null, level: 'TENANT' }
    const scopeB: AuditChainScope = { tenantId: 't2', companyId: null, projectId: null, level: 'TENANT' }
    const rowsA = buildValidChain('tenant:t1', scopeA, 3)
    const rowsB = buildValidChain('tenant:t2', scopeB, 2)

    expect(rowsA[0]!.previousHash).toBe(AUDIT_CHAIN_ZERO_HASH)
    expect(rowsB[0]!.previousHash).toBe(AUDIT_CHAIN_ZERO_HASH)
    expect(rowsA[0]!.eventHash).not.toBe(rowsB[0]!.eventHash)

    const result = verifyAuditChainRows([...rowsA, ...rowsB])
    expect(result.ok).toBe(true)
    expect(result.chains).toBe(2)
  })

  it('partitions strictly by chainScopeKey and orders by sequence, never by insertion order or timestamp', () => {
    const rows = buildValidChain('project:t1:c1:p1', PROJECT_SCOPE, 5)
    const shuffled = [rows[4]!, rows[1]!, rows[3]!, rows[0]!, rows[2]!]
    expect(verifyAuditChainRows(shuffled).ok).toBe(true)
  })

  it('detects a duplicate sequence within one chain', () => {
    const rows = buildValidChain('project:t1:c1:p1', PROJECT_SCOPE, 3)
    const duplicated = [...rows, { ...rows[1]! }]
    const result = verifyAuditChainRows(duplicated)
    expect(result.ok).toBe(false)
    expect(result.errors.some((e) => e.code === 'DUPLICATE_SEQUENCE')).toBe(true)
  })

  it('detects a non-contiguous sequence gap', () => {
    const rows = buildValidChain('project:t1:c1:p1', PROJECT_SCOPE, 3)
    const withGap = [rows[0]!, { ...rows[2]!, sequence: 3 }]
    const result = verifyAuditChainRows(withGap)
    expect(result.ok).toBe(false)
    expect(result.errors.some((e) => e.code === 'NON_CONTIGUOUS_SEQUENCE')).toBe(true)
  })

  it('detects a predecessor-hash mismatch (a scope-B row grafted onto scope-A\'s chain)', () => {
    const rowsA = buildValidChain('project:t1:c1:p1', PROJECT_SCOPE, 2)
    const scopeB: AuditChainScope = { tenantId: 't1', companyId: 'c1', projectId: 'p2', level: 'PROJECT' }
    const rowsB = buildValidChain('project:t1:c1:p2', scopeB, 1)
    const grafted = [rowsA[0]!, { ...rowsB[0]!, chainScopeKey: 'project:t1:c1:p1', sequence: 2 }]
    const result = verifyAuditChainRows(grafted)
    expect(result.ok).toBe(false)
    expect(result.errors.some((e) => e.code === 'PREDECESSOR_MISMATCH')).toBe(true)
  })

  it('detects exactly one deliberately corrupted copy in an otherwise valid chain, without flagging the others', () => {
    const rows = buildValidChain('project:t1:c1:p1', PROJECT_SCOPE, 5)
    const corrupted = rows.map((row, index) => (index === 2 ? { ...row, details: { tampered: true } } : row))
    const result = verifyAuditChainRows(corrupted)
    expect(result.ok).toBe(false)
    const hashErrors = result.errors.filter((e) => e.code === 'HASH_MISMATCH')
    expect(hashErrors).toHaveLength(1)
    expect(hashErrors[0]!.sequence).toBe(3)
  })

  it('rejects a row whose stored eventHash was computed with an unknown version literal', () => {
    const row = makeRow({ chainScopeKey: 'tenant:t1', scope: { tenantId: 't1', companyId: null, projectId: null, level: 'TENANT' }, sequence: 1, previousHash: AUDIT_CHAIN_ZERO_HASH })
    const wrongVersionEnvelope = { ...buildAuditChainEnvelope({ ...row, chainScopeKey: row.chainScopeKey }), version: 'sangfor.audit-chain/v2' } as unknown as AuditChainEnvelope
    const bytes = new TextEncoder().encode(canonicalizeAuditChainEnvelope(wrongVersionEnvelope))
    row.eventHash = createHash('sha256').update(bytes).digest('hex')

    const result = verifyAuditChainRows([row])
    expect(result.ok).toBe(false)
    expect(result.errors.some((e) => e.code === 'HASH_MISMATCH')).toBe(true)
  })
})

import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// @ts-expect-error -- U009's committed reuse module is plain JS, no .d.ts.
import { withIsolatedPostgres } from '../../../../scripts/lib/isolated-postgres.mjs'

import { appendAuditEvent } from './audit-db'
import { logStateTransitionWithAudit } from './audit'
import { AUDIT_CHAIN_ZERO_HASH, verifyAuditChainRows, type AuditChainScope, type PersistedAuditChainRow } from './audit-chain'

const integration = process.env.CI_INTEGRATION === '1'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '../../../..')
const IMAGE_DIGEST = 'sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777'
const RUN_ID = `u021it${Date.now().toString(36)}`
const EVIDENCE_DIR = join(REPO_ROOT, 'tmp/u021-integration-evidence')

const FIXTURE_SQL = `INSERT INTO tenants (id, name, slug, status, created_at) VALUES
  ('adb-tenant-1', 'ADB Tenant One', 'adb-tenant-1', 'active', now()),
  ('adb-tenant-2', 'ADB Tenant Two', 'adb-tenant-2', 'active', now());

INSERT INTO companies (id, tenant_id, name, slug, created_at) VALUES
  ('adb-company-1', 'adb-tenant-1', 'ADB Company One', 'adb-company-1', now());

INSERT INTO projects (id, slug, name, company_id, created_at, updated_at) VALUES
  ('adb-project-1', 'adb-project-1', 'ADB Project One', 'adb-company-1', now(), now());
`

let prisma: PrismaClient | null = null
let cleanupFn: (() => Promise<void>) | null = null

async function rowsForScope(chainScopeKey: string): Promise<PersistedAuditChainRow[]> {
  const client = prisma as PrismaClient
  const rows = await client.auditLog.findMany({ where: { chainScopeKey }, orderBy: { sequence: 'asc' } })
  return rows.map((row) => ({
    chainScopeKey: row.chainScopeKey,
    sequence: row.sequence,
    scope: { tenantId: row.tenantId, companyId: row.companyId, projectId: row.projectId, level: row.scopeLevel as AuditChainScope['level'] },
    eventType: row.eventType,
    actorId: row.actorId,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    details: row.details,
    previousHash: row.previousHash,
    eventHash: row.eventHash,
    occurredAt: toOccurredAt(row.timestamp),
  }))
}

function toOccurredAt(date: Date): string {
  return `${date.toISOString().slice(0, -1)}000Z`
}

describe.skipIf(!integration)('audit-db scoped append-only chain (integration, requires Docker + CI_INTEGRATION=1)', () => {
  beforeAll(async () => {
    let resolveReady: (databaseUrl: string) => void
    const ready = new Promise<string>((r) => (resolveReady = r))
    let releaseCallback: (() => void) | null = null
    const held = new Promise<void>((r) => (releaseCallback = r))

    const lifecycle = withIsolatedPostgres(
      { runId: RUN_ID, ownerUnit: 'U021', purpose: 'audit-chain-integration', evidenceDir: EVIDENCE_DIR, imageDigest: IMAGE_DIGEST, migrate: true },
      async (ctx: { databaseUrl: string }) => {
        resolveReady(ctx.databaseUrl)
        await held
      },
    )
    cleanupFn = async () => {
      releaseCallback?.()
      await lifecycle
    }

    const databaseUrl = await ready
    prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
    for (const statement of FIXTURE_SQL.split(';\n\n')) {
      const trimmed = statement.trim()
      if (trimmed.length === 0) continue
      await prisma.$executeRawUnsafe(`${trimmed};`)
    }
  }, 180_000)

  afterAll(async () => {
    await prisma?.$disconnect()
    await cleanupFn?.()
  }, 60_000)

  it('32 concurrent appends to one scope produce 32 unique, contiguous sequences forming one valid chain', async () => {
    const client = prisma as PrismaClient
    const scope: AuditChainScope = { tenantId: 'adb-tenant-1', companyId: 'adb-company-1', projectId: 'adb-project-1', level: 'PROJECT' }

    await Promise.all(
      Array.from({ length: 32 }, (_, i) =>
        client.$transaction((tx) =>
          appendAuditEvent(tx, {
            scope,
            eventType: 'concurrency.probe',
            actorId: `user-${i}`,
            resourceType: 'demo',
            resourceId: 'concurrency-res',
            details: { i },
          }),
        ),
      ),
    )

    const chainScopeKey = 'project:adb-tenant-1:adb-company-1:adb-project-1'
    const rows = await rowsForScope(chainScopeKey)
    expect(rows).toHaveLength(32)
    expect(new Set(rows.map((r) => r.sequence)).size).toBe(32)
    expect(rows.map((r) => r.sequence).sort((a, b) => a - b)).toEqual(Array.from({ length: 32 }, (_, i) => i + 1))

    const result = verifyAuditChainRows(rows)
    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
  }, 60_000)

  it('two scopes never share a predecessor: each gets its own independent 64-zero genesis', async () => {
    const client = prisma as PrismaClient
    const scopeA: AuditChainScope = { tenantId: 'adb-tenant-1', companyId: null, projectId: null, level: 'TENANT' }
    const scopeB: AuditChainScope = { tenantId: 'adb-tenant-2', companyId: null, projectId: null, level: 'TENANT' }

    const eventA = await client.$transaction((tx) => appendAuditEvent(tx, { scope: scopeA, eventType: 'scope.probe', actorId: 'user-a', resourceType: 'demo', resourceId: 'scope-a-res' }))
    const eventB = await client.$transaction((tx) => appendAuditEvent(tx, { scope: scopeB, eventType: 'scope.probe', actorId: 'user-b', resourceType: 'demo', resourceId: 'scope-b-res' }))

    expect(eventA.previousHash).toBe(AUDIT_CHAIN_ZERO_HASH)
    expect(eventB.previousHash).toBe(AUDIT_CHAIN_ZERO_HASH)
    expect(eventA.eventHash).not.toBe(eventB.eventHash)
    expect(eventA.chainScopeKey).not.toBe(eventB.chainScopeKey)
  })

  it('rejects direct UPDATE and DELETE against audit_logs with the named append-only error', async () => {
    const client = prisma as PrismaClient
    const created = await client.$transaction((tx) =>
      appendAuditEvent(tx, {
        scope: { tenantId: 'adb-tenant-1', companyId: null, projectId: null, level: 'TENANT' },
        eventType: 'immutability.probe',
        actorId: 'user-immutable',
        resourceType: 'demo',
        resourceId: 'immutable-res',
      }),
    )

    await expect(client.$executeRawUnsafe(`UPDATE audit_logs SET event_type = 'tampered' WHERE id = '${created.id}'`)).rejects.toThrow(/append-only/i)
    await expect(client.$executeRawUnsafe(`DELETE FROM audit_logs WHERE id = '${created.id}'`)).rejects.toThrow(/append-only/i)

    const stillThere = await client.auditLog.findUniqueOrThrow({ where: { id: created.id } })
    expect(stillThere.eventType).toBe('immutability.probe')
  })

  it('rolls back the domain mutation when the audit append is forced to fail (atomic commit/rollback)', async () => {
    const client = prisma as PrismaClient
    const entityId = `rollback-probe-${Date.now()}`

    await expect(
      client.$transaction((tx) =>
        logStateTransitionWithAudit(
          { entityType: 'demo-entity', entityId, toStatus: 'done' },
          {
            // An impossible scope (COMPANY level with no companyId) makes deriveChainScopeKey throw
            // inside appendAuditEvent, forcing the audit append to fail after the domain mutation
            // (stateTransitionLog.create) has already run in the SAME transaction.
            scope: { tenantId: 'adb-tenant-1', companyId: null, projectId: null, level: 'COMPANY' } as AuditChainScope,
          },
          tx,
        ),
      ),
    ).rejects.toThrow()

    const found = await client.stateTransitionLog.findFirst({ where: { entityId } })
    expect(found).toBeNull()
  })

  it('a duplicate idempotency key returns the original result and writes no second row', async () => {
    const client = prisma as PrismaClient
    const scope: AuditChainScope = { tenantId: 'adb-tenant-1', companyId: null, projectId: null, level: 'TENANT' }
    const idempotencyKey = `idem-${Date.now()}`

    const first = await client.$transaction((tx) => appendAuditEvent(tx, { scope, eventType: 'idempotent.probe', actorId: 'user-idem', resourceType: 'demo', resourceId: 'idem-res', idempotencyKey }))
    const second = await client.$transaction((tx) => appendAuditEvent(tx, { scope, eventType: 'idempotent.probe', actorId: 'user-idem', resourceType: 'demo', resourceId: 'idem-res', idempotencyKey }))

    expect(second.id).toBe(first.id)
    expect(second.idempotent).toBe(true)

    const count = await client.auditLog.count({ where: { idempotencyKey } })
    expect(count).toBe(1)
  })

  it('a concurrent duplicate idempotency key race still writes no second row', async () => {
    const client = prisma as PrismaClient
    const scope: AuditChainScope = { tenantId: 'adb-tenant-1', companyId: null, projectId: null, level: 'TENANT' }
    const idempotencyKey = `idem-race-${Date.now()}`

    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        client.$transaction((tx) => appendAuditEvent(tx, { scope, eventType: 'idempotent.race', actorId: 'user-race', resourceType: 'demo', resourceId: 'idem-race-res', idempotencyKey })),
      ),
    )

    const ids = new Set(results.map((r) => r.id))
    expect(ids.size).toBe(1)

    const count = await client.auditLog.count({ where: { idempotencyKey } })
    expect(count).toBe(1)
  })

  it('actor and scope are persisted exactly as supplied by the (simulated) caller context', async () => {
    const client = prisma as PrismaClient
    const scope: AuditChainScope = { tenantId: 'adb-tenant-1', companyId: 'adb-company-1', projectId: 'adb-project-1', level: 'PROJECT' }
    const created = await client.$transaction((tx) => appendAuditEvent(tx, { scope, eventType: 'context.probe', actorId: 'user-context-1', resourceType: 'demo', resourceId: 'context-res' }))

    const row = await client.auditLog.findUniqueOrThrow({ where: { id: created.id } })
    expect(row.tenantId).toBe('adb-tenant-1')
    expect(row.companyId).toBe('adb-company-1')
    expect(row.projectId).toBe('adb-project-1')
    expect(row.scopeLevel).toBe('PROJECT')
    expect(row.actorId).toBe('user-context-1')
  })

  it('independently reconstructs the exact sangfor.audit-chain/v1 bytes and digest for a real persisted row', async () => {
    const client = prisma as PrismaClient
    const scope: AuditChainScope = { tenantId: 'adb-tenant-1', companyId: null, projectId: null, level: 'TENANT' }
    const created = await client.$transaction((tx) => appendAuditEvent(tx, { scope, eventType: 'byte-vector.probe', actorId: 'user-byte', resourceType: 'demo', resourceId: 'byte-res', details: { k: 'v' } }))

    const rows = await rowsForScope(created.chainScopeKey)
    const thisRow = rows.find((r) => r.sequence === created.sequence)!
    const result = verifyAuditChainRows(rows)
    expect(result.ok).toBe(true)
    expect(thisRow.eventHash).toBe(created.eventHash)
  })
})

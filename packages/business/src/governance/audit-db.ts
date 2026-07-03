import { Prisma, prisma } from '@sangfor/db'
import { AUDIT_CHAIN_ZERO_HASH, AuditChain, type AuditEvent } from './audit-chain'

interface PersistedAuditLog {
  eventType: string
  actorId: string | null
  resourceType: string
  resourceId: string | null
  details: unknown
  previousHash: string | null
  eventHash: string | null
  timestamp: Date
}

export async function recordAuditEvent(
  eventType: string,
  actorId: string,
  resourceType: string,
  resourceId: string,
  details: Record<string, unknown> = {}
) {
  const previousHash = await getLastPersistedAuditHash()
  const event = AuditChain.createEvent(eventType, actorId, resourceType, resourceId, details, previousHash)
  await prisma.auditLog.create({
    data: {
      eventType: event.eventType,
      actorId: event.actorId,
      resourceType: event.resourceType,
      resourceId: event.resourceId,
      details: toPrismaJsonObject(details),
      previousHash: event.previousHash,
      eventHash: event.hash,
      timestamp: new Date(event.timestamp),
    }
  })
  return event
}

export async function verifyAuditIntegrity(): Promise<boolean> {
  const logs = await prisma.auditLog.findMany({ orderBy: { timestamp: 'asc' } })
  return verifyPersistedAuditLogs(logs)
}

export function verifyPersistedAuditLogs(logs: PersistedAuditLog[]): boolean {
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

async function getLastPersistedAuditHash(): Promise<string> {
  const latest = await prisma.auditLog.findFirst({
    orderBy: [{ timestamp: 'desc' }, { createdAt: 'desc' }],
    select: { eventHash: true },
  })

  if (!latest) {
    return AUDIT_CHAIN_ZERO_HASH
  }
  if (!latest.eventHash) {
    throw new Error('Cannot append audit event after an unhashed audit log')
  }
  return latest.eventHash
}

function toAuditDetails(details: unknown): Record<string, unknown> {
  if (details && typeof details === 'object' && !Array.isArray(details)) {
    return details as Record<string, unknown>
  }
  return {}
}

function toPrismaJsonObject(details: Record<string, unknown>): Prisma.InputJsonObject {
  return JSON.parse(JSON.stringify(details)) as Prisma.InputJsonObject
}

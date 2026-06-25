import { prisma } from '@sangfor/db'
import { AuditChain } from './audit-chain'

const chain = new AuditChain()

export async function recordAuditEvent(
  eventType: string,
  actorId: string,
  resourceType: string,
  resourceId: string,
  details: Record<string, unknown> = {}
) {
  const event = chain.record(eventType, actorId, resourceType, resourceId, details)
  await prisma.auditLog.create({
    data: {
      eventType: event.eventType,
      actorId: event.actorId,
      resourceType: event.resourceType,
      resourceId: event.resourceId,
      details: details as any,
      previousHash: event.previousHash,
      eventHash: event.hash,
      timestamp: new Date(event.timestamp),
    }
  })
  return event
}

export async function verifyAuditIntegrity(): Promise<boolean> {
  const logs = await prisma.auditLog.findMany({ orderBy: { timestamp: 'asc' } })
  let previousHash = '0'.repeat(64)
  for (const log of logs) {
    const expectedHash = AuditChain.computeHash(
      log.eventType,
      log.actorId ?? '',
      log.resourceType,
      log.resourceId ?? '',
      (log.details ?? {}) as Record<string, unknown>,
      log.timestamp.toISOString(),
      previousHash,
    )
    if (log.eventHash !== expectedHash || log.previousHash !== previousHash) return false
    previousHash = log.eventHash
  }
  return true
}

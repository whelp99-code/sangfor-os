import { createHash } from 'crypto'

export const AUDIT_CHAIN_ZERO_HASH = '0'.repeat(64)

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

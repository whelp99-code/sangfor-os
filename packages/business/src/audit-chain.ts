import { createHash } from 'crypto'

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
  private lastHash = '0'.repeat(64)

  record(eventType: string, actorId: string, resourceType: string, resourceId: string, details: Record<string, unknown> = {}): AuditEvent {
    const timestamp = new Date().toISOString()
    const canonicalJson = JSON.stringify({ eventType, actorId, resourceType, resourceId, details, timestamp, previousHash: this.lastHash })
    const hash = createHash('sha256').update(canonicalJson).digest('hex')
    const event: AuditEvent = {
      id: `audit-${this.events.length + 1}-${Date.now()}`,
      previousHash: this.lastHash,
      eventType, actorId, resourceType, resourceId, details, timestamp, hash,
    }
    this.events.push(event)
    this.lastHash = hash
    return event
  }

  getEvents(): AuditEvent[] { return [...this.events] }
  getLastHash(): string { return this.lastHash }
  verifyIntegrity(): boolean {
    let hash = '0'.repeat(64)
    for (const event of this.events) {
      const canonicalJson = JSON.stringify({ eventType: event.eventType, actorId: event.actorId, resourceType: event.resourceType, resourceId: event.resourceId, details: event.details, timestamp: event.timestamp, previousHash: hash })
      const expectedHash = createHash('sha256').update(canonicalJson).digest('hex')
      if (event.hash !== expectedHash || event.previousHash !== hash) return false
      hash = event.hash
    }
    return true
  }
}

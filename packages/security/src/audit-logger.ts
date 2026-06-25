import crypto from 'node:crypto'

export interface AuditEntry {
  id: string
  action: string
  actorId: string
  resourceType: string
  resourceId: string
  details: Record<string, unknown>
  timestamp: string
  ipAddress?: string
}

export class AuditLogger {
  private entries: AuditEntry[] = []

  log(entry: Omit<AuditEntry, 'id' | 'timestamp'>): AuditEntry {
    const full: AuditEntry = {
      ...entry,
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
    }
    this.entries.push(full)
    return full
  }

  query(filters: Partial<AuditEntry>): AuditEntry[] {
    return this.entries.filter((entry) => {
      for (const [key, value] of Object.entries(filters)) {
        if (value === undefined) continue
        if (entry[key as keyof AuditEntry] !== value) return false
      }
      return true
    })
  }

  getRecent(limit: number): AuditEntry[] {
    return this.entries.slice(-limit).reverse()
  }
}

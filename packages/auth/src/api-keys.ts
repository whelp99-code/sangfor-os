import crypto from 'node:crypto'
import type { Role } from './types'

interface KeyRecord {
  name: string
  role: Role
  expiresAt: number | null
  keyHash: string
}

export class ApiKeyManager {
  private keys = new Map<string, KeyRecord>()

  generateKey(name: string, role: Role, expiresInDays?: number): string {
    const key = `ak_${crypto.randomBytes(32).toString('hex')}`
    const keyHash = this.hashKey(key)
    const expiresAt = expiresInDays !== undefined
      ? Date.now() + expiresInDays * 24 * 60 * 60 * 1000
      : null

    this.keys.set(keyHash, { name, role, expiresAt, keyHash })
    return key
  }

  registerKey(key: string, name: string, role: Role, expiresInDays?: number): void {
    const keyHash = this.hashKey(key)
    const expiresAt = expiresInDays !== undefined
      ? Date.now() + expiresInDays * 24 * 60 * 60 * 1000
      : null

    this.keys.set(keyHash, { name, role, expiresAt, keyHash })
  }

  validateKey(key: string): { name: string; role: Role } | null {
    const keyHash = this.hashKey(key)
    const record = this.keys.get(keyHash)
    if (!record) return null
    if (record.expiresAt !== null && Date.now() >= record.expiresAt) {
      this.keys.delete(keyHash)
      return null
    }
    return { name: record.name, role: record.role }
  }

  revokeKey(key: string): void {
    const keyHash = this.hashKey(key)
    this.keys.delete(keyHash)
  }

  listKeys(): Array<{ name: string; role: Role; prefix: string }> {
    return Array.from(this.keys.entries())
      .filter(([_, record]) => !(record.expiresAt !== null && Date.now() >= record.expiresAt))
      .map(([keyHash, record]) => ({
        name: record.name,
        role: record.role,
        prefix: keyHash.substring(0, 8),
      }))
  }

  private hashKey(key: string): string {
    return crypto.createHash('sha256').update(key).digest('hex')
  }
}

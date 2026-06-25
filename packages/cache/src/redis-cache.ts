import Redis from 'ioredis'

export class RedisCache {
  private store = new Map<string, { value: unknown; expiresAt: number }>()
  private redis: Redis | null = null
  private useRedis = false

  constructor(redisUrl?: string) {
    const url = redisUrl || process.env.REDIS_URL
    if (url) {
      try {
        this.redis = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 0 })
        this.useRedis = true
      } catch {
        console.warn('[Cache] Redis unavailable, using in-memory store')
      }
    }
  }

  async get<T>(key: string): Promise<T | null> {
    if (this.useRedis && this.redis) {
      try {
        const val = await this.redis.get(key)
        if (val) return JSON.parse(val) as T
      } catch {
        /* fall through to memory */
      }
    }
    const entry = this.store.get(key)
    if (!entry) return null
    if (entry.expiresAt > 0 && Date.now() > entry.expiresAt) {
      this.store.delete(key)
      return null
    }
    return entry.value as T
  }

  async set(key: string, value: unknown, ttlMs?: number): Promise<void> {
    if (this.useRedis && this.redis) {
      try {
        if (ttlMs) {
          await this.redis.set(key, JSON.stringify(value), 'PX', ttlMs)
        } else {
          await this.redis.set(key, JSON.stringify(value))
        }
        return
      } catch {
        /* fall through to memory */
      }
    }
    const expiresAt = ttlMs ? Date.now() + ttlMs : 0
    this.store.set(key, { value, expiresAt })
  }

  async del(key: string): Promise<void> {
    if (this.useRedis && this.redis) {
      try {
        await this.redis.del(key)
      } catch {
        /* ignore */
      }
    }
    this.store.delete(key)
  }

  async clear(): Promise<void> {
    if (this.useRedis && this.redis) {
      try {
        await this.redis.flushdb()
      } catch {
        /* ignore */
      }
    }
    this.store.clear()
  }

  get size(): number {
    return this.store.size
  }

  async destroy(): Promise<void> {
    if (this.redis) {
      await this.redis.quit().catch(() => {})
      this.redis = null
    }
    this.store.clear()
  }
}

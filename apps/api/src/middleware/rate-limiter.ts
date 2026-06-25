/**
 * Rate Limiter Middleware
 * 요청 속도 제한 미들웨어
 */

import type { Request, Response, NextFunction } from 'express';

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

const store = new Map<string, RateLimitEntry>();

// Cleanup expired entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (now > entry.resetTime) store.delete(key);
  }
}, 5 * 60 * 1000);

export interface RateLimiterConfig {
  windowMs?: number;
  maxRequests?: number;
}

export function rateLimiter(config: RateLimiterConfig = {}) {
  const windowMs = config.windowMs || 60000; // 1분
  const maxRequests = config.maxRequests || 100;

  return (req: Request, res: Response, next: NextFunction): void => {
    const key = req.ip || 'unknown';
    const now = Date.now();

    let entry = store.get(key);
    if (!entry || now > entry.resetTime) {
      entry = { count: 0, resetTime: now + windowMs };
      store.set(key, entry);
    }

    entry.count++;

    res.setHeader('X-RateLimit-Limit', maxRequests);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, maxRequests - entry.count));
    res.setHeader('X-RateLimit-Reset', Math.ceil(entry.resetTime / 1000));

    if (entry.count > maxRequests) {
      res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many requests' } });
      return;
    }

    next();
  };
}

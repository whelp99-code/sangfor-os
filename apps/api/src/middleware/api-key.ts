import type { Request, Response, NextFunction } from 'express'
import { ApiKeyManager } from '@sangfor/auth'

const keyManager = new ApiKeyManager()

export function apiKeyMiddleware(req: Request, res: Response, next: NextFunction) {
  const apiKey = req.headers['x-api-key'] as string
  if (!apiKey) {
    return res.status(401).json({ error: 'API key required' })
  }
  const result = keyManager.validateKey(apiKey)
  if (!result) {
    return res.status(403).json({ error: 'Invalid API key' })
  }
  req.user = { id: `apikey:${result.name}`, email: '', name: result.name, role: result.role }
  next()
}

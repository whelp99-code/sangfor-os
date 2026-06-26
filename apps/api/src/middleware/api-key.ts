import type { Request, Response, NextFunction } from 'express'
import { ApiKeyManager, createDevelopmentAuthContext, type Role, type BusinessRole } from '@sangfor/auth'

const keyManager = new ApiKeyManager()

const API_KEY_ROLE_TO_BUSINESS_ROLE: Record<Role, BusinessRole> = {
  admin: 'system_admin',
  manager: 'finance_manager',
  user: 'account_manager',
  viewer: 'account_manager',
}

export function apiKeyMiddleware(req: Request, res: Response, next: NextFunction) {
  const apiKey = req.headers['x-api-key'] as string
  if (!apiKey) {
    return res.status(401).json({ error: 'API key required' })
  }
  const result = keyManager.validateKey(apiKey)
  if (!result) {
    return res.status(403).json({ error: 'Invalid API key' })
  }
  const authContext = createDevelopmentAuthContext({
    userId: `apikey:${result.name}`,
    sessionId: `apikey:${result.name}`,
    tenantId: process.env.DEFAULT_TENANT_ID ?? 'dev-tenant',
    companyId: process.env.DEFAULT_COMPANY_ID ?? 'dev-company',
    businessRole: API_KEY_ROLE_TO_BUSINESS_ROLE[result.role],
  })
  req.authContext = authContext
  req.user = {
    id: authContext.userId,
    email: '',
    name: result.name,
    role: authContext.businessRole,
    authContext,
  }
  next()
}

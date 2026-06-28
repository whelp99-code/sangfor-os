import type { Request, Response, NextFunction } from 'express'
import { ApiKeyManager, createDevelopmentAuthContext, type Role, type BusinessRole } from '@sangfor/auth'

const keyManager = new ApiKeyManager()

const ENV_API_KEYS: Array<{ env: string; name: string; role: Role }> = [
  { env: 'FINANCE_API_KEY', name: 'finance', role: 'manager' },
  { env: 'API_KEY', name: 'default', role: 'admin' },
]

const API_KEY_ROLE_TO_BUSINESS_ROLE: Record<Role, BusinessRole> = {
  admin: 'system_admin',
  manager: 'finance_manager',
  user: 'account_manager',
  viewer: 'account_manager',
}

let hasConfiguredKeys = false
for (const { env, name, role } of ENV_API_KEYS) {
  const key = process.env[env]?.trim()
  if (key) {
    keyManager.registerKey(key, name, role)
    hasConfiguredKeys = true
  }
}

function applyDevAuthContext(req: Request, name: string, role: Role) {
  const authContext = createDevelopmentAuthContext({
    userId: `apikey:${name}`,
    sessionId: `apikey:${name}`,
    tenantId: process.env.DEFAULT_TENANT_ID ?? 'dev-tenant',
    companyId: process.env.DEFAULT_COMPANY_ID ?? 'dev-company',
    businessRole: API_KEY_ROLE_TO_BUSINESS_ROLE[role],
  })
  req.authContext = authContext
  req.user = {
    id: authContext.userId,
    email: '',
    name,
    role: authContext.businessRole,
    authContext,
  }
}

export function apiKeyMiddleware(req: Request, res: Response, next: NextFunction) {
  const apiKey = req.headers['x-api-key'] as string
  if (!apiKey) {
    // Dev bypass (consistent with auth.ts / context.ts): when not in production
    // and no API keys are configured, allow local tooling/dashboards through
    // with an admin dev context instead of forcing manual key setup.
    if (process.env.NODE_ENV !== 'production' && !hasConfiguredKeys) {
      applyDevAuthContext(req, 'dev', 'admin')
      return next()
    }
    return res.status(401).json({ error: 'API key required' })
  }
  const result = keyManager.validateKey(apiKey)
  if (!result) {
    return res.status(403).json({ error: 'Invalid API key' })
  }
  applyDevAuthContext(req, result.name, result.role)
  next()
}

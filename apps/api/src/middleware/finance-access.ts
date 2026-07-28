import type { Request, Response, NextFunction } from 'express'

// Roles permitted to read/write CFO finance data. Applied after apiKeyMiddleware
// (which resolves req.user.role from the API key, or an admin dev context when
// no key is configured in development).
export const FINANCE_ROLES = new Set(['system_admin', 'finance_manager', 'ceo'])

export function financeAccessGuard(req: Request, res: Response, next: NextFunction) {
  if (req.internalPrincipal?.profile !== 'FINANCE' || req.internalPrincipal.subjectType !== 'human_delegation') {
    return res.status(401).json({ error: 'INTERNAL_PRINCIPAL_REQUIRED' })
  }
  const role = req.user?.role
  if (!role || !FINANCE_ROLES.has(role)) {
    return res.status(403).json({ error: 'finance access denied', requiredRoles: [...FINANCE_ROLES] })
  }
  next()
}

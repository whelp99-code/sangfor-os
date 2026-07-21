import type { Request, Response, NextFunction } from 'express'
import { RBAC, type BusinessPermission, type Permission } from '@sangfor/auth'

const rbac = new RBAC()

export function requirePermission(permission: Permission) {
  return (req: Request, res: Response, next: NextFunction) => {
    const role = (req.user?.role?.toLowerCase() ?? 'viewer') as Parameters<typeof rbac.hasPermission>[0]
    if (rbac.hasPermission(role, permission)) {
      next()
    } else {
      res.status(403).json({ error: `Forbidden: requires ${permission} permission` })
    }
  }
}

// U015/SEC-02a: the BusinessPermission-typed counterpart of requirePermission above. Reads
// req.authContext.permissions, which — for any route also chained behind
// business-authorization.ts's requireBusinessCapability — is the DB-recomputed set, not a
// token-supplied one. Unlike requirePermission's coarse Role, this never has to guess a role
// string; it checks the exact capability.
export function requireBusinessPermission(permission: BusinessPermission) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.authContext?.permissions.includes(permission)) {
      next()
    } else {
      res.status(403).json({ error: `Forbidden: requires ${permission} permission` })
    }
  }
}

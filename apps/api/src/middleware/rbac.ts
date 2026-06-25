import type { Request, Response, NextFunction } from 'express'
import { RBAC, type Permission } from '@sangfor/auth'

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

import type { NextFunction, Request, Response } from 'express'

export function systemAdminAccessGuard(req: Request, res: Response, next: NextFunction): void {
  if (req.authContext?.businessRole !== 'system_admin') {
    res.status(403).json({ error: 'system admin access required' })
    return
  }

  next()
}

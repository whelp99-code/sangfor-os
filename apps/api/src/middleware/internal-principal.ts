import type { NextFunction, Request, Response } from 'express';
import {
  INTERNAL_PRINCIPAL_HEADER,
  verifyInternalPrincipal,
  type VerifiedInternalPrincipal,
  type BusinessPermission,
} from '@sangfor/auth';
import { getInternalPrincipalConfig, type InternalPrincipalConfig, type InternalPrincipalProfile } from '@sangfor/config';
import { claimInternalPrincipalReplay } from '@sangfor/business';

export interface InternalPrincipalMiddlewareOptions {
  readonly profile: InternalPrincipalProfile;
  readonly config?: InternalPrincipalConfig;
  readonly now?: () => number;
  readonly claimReplay?: (principal: VerifiedInternalPrincipal) => Promise<unknown>;
}

declare global {
  namespace Express {
    interface Request {
      internalPrincipal?: VerifiedInternalPrincipal;
      rawBody?: string;
    }
  }
}

function requestBody(req: Request): string {
  if (req.method === 'GET' || req.method === 'HEAD') return '';
  if (typeof req.rawBody === 'string') return req.rawBody;
  if (req.body === undefined || req.body === null) return '';
  return JSON.stringify(req.body);
}

function attachSignedHuman(req: Request, principal: VerifiedInternalPrincipal): void {
  if (principal.subjectType !== 'human_delegation' || principal.businessRole === null || principal.sessionId === null) {
    throw new Error('profile did not produce a signed human');
  }
  const authContext = {
    userId: principal.subjectId,
    sessionId: principal.sessionId,
    tenantId: principal.tenantId,
    companyId: principal.companyId,
    projectId: principal.projectId,
    businessRole: principal.businessRole,
    permissions: [...principal.capabilities] as BusinessPermission[],
    product: 'internal-principal',
  };
  req.authContext = authContext;
  req.user = { id: authContext.userId, email: authContext.userId, name: authContext.userId, role: authContext.businessRole, authContext };
}

/**
 * Verifies a closed-profile envelope before attaching authority. A malformed,
 * expired, replayed, or absent envelope never falls back to transport API-key
 * identity or forwarded x-user headers.
 */
export function createInternalPrincipalMiddleware(options: InternalPrincipalMiddlewareOptions) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const token = req.headers[INTERNAL_PRINCIPAL_HEADER] as string | string[] | undefined;
    if (typeof token !== 'string' || token.length === 0) {
      res.status(401).json({ error: 'INTERNAL_PRINCIPAL_REQUIRED' });
      return;
    }
    try {
      const url = new URL(req.originalUrl || req.url, 'http://internal.invalid');
      const principal = verifyInternalPrincipal(token, {
        profile: options.profile,
        method: req.method,
        path: url.pathname,
        query: url.search,
        body: requestBody(req),
      }, options.config ?? getInternalPrincipalConfig(options.now?.()), options.now?.());
      const claim = options.claimReplay ?? ((value: VerifiedInternalPrincipal) => claimInternalPrincipalReplay({
        profile: value.profile, subjectId: value.subjectId, tenantId: value.tenantId, companyId: value.companyId, projectId: value.projectId,
        jti: value.jti, nonce: value.nonce, idempotencyKey: value.idempotencyKey,
      }));
      await claim(principal);
      req.internalPrincipal = principal;
      if (principal.subjectType === 'human_delegation') attachSignedHuman(req, principal);
      next();
    } catch (error) {
      console.error('[api] internal_principal_rejected:', error instanceof Error ? error.message : 'unknown');
      res.status(401).json({ error: 'INVALID_INTERNAL_PRINCIPAL' });
    }
  };
}

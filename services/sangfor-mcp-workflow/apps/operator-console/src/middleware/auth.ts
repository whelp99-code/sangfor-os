import type { NextFunction, Request, Response } from 'express';
import {
  IdentityConflictError,
  authenticateWorkflowApiKey,
  enforceServerIdentity,
  stripCallerIdentityFields,
  type AuthContext,
} from '../../../../packages/shared/src/mutation-policy.js';

type ServerPrincipal = {
  readonly principalId: string;
  readonly role: string;
  readonly source: string;
};

type AuthLocals = {
  authContext?: ServerPrincipal;
};

function readPresentedKey(request: Request): string | undefined {
  const value = request.headers['x-api-key'];
  return typeof value === 'string' ? value : undefined;
}

function readServerPrincipal(response: Response<unknown, AuthLocals>): ServerPrincipal | undefined {
  return response.locals.authContext;
}

export function apiKeyAuth(
  request: Request,
  response: Response<unknown, AuthLocals>,
  next: NextFunction,
): void {
  if (readServerPrincipal(response)) {
    next();
    return;
  }

  const context = authenticateWorkflowApiKey(readPresentedKey(request), {
    apiKey: process.env.SANGFOR_API_KEY,
    principalId: process.env.SANGFOR_OPERATOR_PRINCIPAL_ID,
  });
  if (!context) {
    response.status(401).json({ error: 'UNAUTHENTICATED' });
    return;
  }

  response.locals.authContext = context;
  next();
}

export function requireOperatorContext(
  _request: Request,
  response: Response<unknown, AuthLocals>,
  next: NextFunction,
): void {
  const context = readServerPrincipal(response);
  if (!context) {
    response.status(401).json({ error: 'UNAUTHENTICATED' });
    return;
  }
  if (context.role !== 'operator' || context.source !== 'api_key') {
    response.status(403).json({ error: 'FORBIDDEN' });
    return;
  }
  next();
}

export function getOperatorContext(response: Response<unknown, AuthLocals>): AuthContext {
  const context = readServerPrincipal(response);
  if (!context || context.role !== 'operator' || context.source !== 'api_key') {
    throw new TypeError('Operator middleware did not establish an operator context');
  }
  return { principalId: context.principalId, role: 'operator', source: 'api_key' };
}

export function identityConflictGuard(
  request: Request,
  response: Response<unknown, AuthLocals>,
  next: NextFunction,
): void {
  try {
    enforceServerIdentity(getOperatorContext(response), request.body);
    request.body = stripCallerIdentityFields(request.body);
    next();
  } catch (error) {
    if (error instanceof IdentityConflictError) {
      response.status(400).json({ error: error.code });
      return;
    }
    throw error;
  }
}

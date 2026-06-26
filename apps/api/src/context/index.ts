/**
 * tRPC Context
 * 요청 컨텍스트 생성 (JWT 검증)
 */

import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { Context } from "../context";
import {
  createAuthContextFromTokenPayload,
  createDevelopmentAuthContext,
  getTokenManager,
  type AuthContext,
} from "@sangfor/auth";

function anonymousContext(): Context {
  return {
    userId: null,
    userRole: null,
    sessionId: null,
    authContext: null,
    tenantId: null,
    companyId: null,
    businessRole: null,
  };
}

function contextFromAuth(authContext: AuthContext): Context {
  return {
    userId: authContext.userId,
    userRole: authContext.businessRole,
    sessionId: authContext.sessionId,
    authContext,
    tenantId: authContext.tenantId,
    companyId: authContext.companyId,
    businessRole: authContext.businessRole,
  };
}

function developmentScopeFallback() {
  if (process.env.NODE_ENV === "production") return undefined;
  return {
    tenantId: process.env.DEFAULT_TENANT_ID ?? "dev-tenant",
    companyId: process.env.DEFAULT_COMPANY_ID ?? "dev-company",
    businessRole: "account_manager" as const,
  };
}

export async function createContext({ req }: CreateExpressContextOptions): Promise<Context> {
  const authHeader = req.headers.authorization;

  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    const payload = await getTokenManager().verifyToken(token);

    if (payload) {
      const authContext = createAuthContextFromTokenPayload(payload, developmentScopeFallback());
      if (authContext) return contextFromAuth(authContext);
    }

    return anonymousContext();
  }

  const cookie = req.headers.cookie || "";
  const sessionToken = cookie
    .split(";")
    .find((c) => c.trim().startsWith("next-auth.session-token="))
    ?.split("=")[1];

  if (sessionToken) {
    return contextFromAuth(
      createDevelopmentAuthContext({
        userId: "session-user",
        sessionId: sessionToken.slice(0, 8),
        businessRole: "account_manager",
      }),
    );
  }

  return anonymousContext();
}

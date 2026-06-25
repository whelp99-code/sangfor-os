/**
 * tRPC Context
 * 요청 컨텍스트 생성 (JWT 검증)
 */

import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { Context } from "../context";
import { getTokenManager } from "@sangfor/auth";

export async function createContext({ req }: CreateExpressContextOptions): Promise<Context> {
  const authHeader = req.headers.authorization;

  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    const payload = await getTokenManager().verifyToken(token);

    if (payload) {
      return {
        userId: payload.sub,
        userRole: "user",
        sessionId: payload.jti,
      };
    }

    return {
      userId: null,
      userRole: null,
      sessionId: null,
    };
  }

  const cookie = req.headers.cookie || "";
  const sessionToken = cookie
    .split(";")
    .find((c) => c.trim().startsWith("next-auth.session-token="))
    ?.split("=")[1];

  if (sessionToken) {
    return {
      userId: "session-user",
      userRole: "user",
      sessionId: sessionToken.slice(0, 8),
    };
  }

  return {
    userId: null,
    userRole: null,
    sessionId: null,
  };
}

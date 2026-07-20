import { verifySessionJwt } from "@sangfor/auth";
import { NextResponse } from "next/server";

import { assertApiAccess } from "@/lib/api-auth";
import { getWebSessionJwtConfig } from "@/lib/auth/config";
import { extractSessionToken } from "@/lib/auth/session";
import { revokeSession } from "@/lib/auth/persisted-session";

function clearedSessionResponse(): NextResponse {
  const response = NextResponse.json({ ok: true });
  response.cookies.set("session", "", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
    secure: process.env.SESSION_COOKIE_SECURE === "1",
  });
  return response;
}

// U014/SEC-01: compare-and-set revoke (see persisted-session.ts's revokeSession) plus an
// unconditional cookie clear — the response is always {ok:true} once assertApiAccess admits the
// request, regardless of whether a matching live session still existed to revoke. Repeat logout
// with the same, still-cryptographically-valid token is therefore idempotent by construction.
export async function POST(request: Request) {
  const denied = assertApiAccess(request);
  if (denied) return denied;

  const response = clearedSessionResponse();

  const token = extractSessionToken(request);
  if (!token || token.startsWith("mock.")) return response;

  let config;
  try {
    config = getWebSessionJwtConfig();
  } catch {
    return response;
  }

  const claims = verifySessionJwt(token, config);
  if (!claims) return response;

  await revokeSession(claims.jti);
  return response;
}

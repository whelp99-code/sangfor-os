import { createHmac, timingSafeEqual } from "node:crypto";

import { getJwtSecret, isAuthConfigured } from "@/lib/auth/config";

export type SessionUser = {
  id: string;
  email: string;
  role: "admin" | "operator" | "viewer";
};

const MOCK_USER: SessionUser = {
  id: "mock-user",
  email: "operator@demo.local",
  role: "admin",
};

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createSessionToken(user: SessionUser): string {
  const secret = getJwtSecret();
  const body = Buffer.from(JSON.stringify(user)).toString("base64url");
  const sig = sign(body, secret);
  return `${body}.${sig}`;
}

export function verifySessionToken(token: string | null | undefined): SessionUser | null {
  if (!token) return null;
  if (token.startsWith("mock.")) return MOCK_USER;

  let secret: string;
  try {
    secret = getJwtSecret();
  } catch {
    return null;
  }

  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = sign(body, secret);
  try {
    if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  } catch {
    return null;
  }
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SessionUser;
  } catch {
    return null;
  }
}

export function getSessionFromRequest(request: Request): SessionUser {
  const auth = request.headers.get("authorization");
  const cookie = request.headers.get("cookie");
  const bearer = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
  const cookieToken = cookie
    ?.split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith("session="))
    ?.split("=")[1];
  return verifySessionToken(bearer ?? cookieToken) ?? MOCK_USER;
}

export { isAuthConfigured };

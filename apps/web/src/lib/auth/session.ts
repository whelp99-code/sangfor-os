import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

import { getJwtSecret, isAuthConfigured } from "@/lib/auth/config";

const sessionUserSchema = z.object({
  id: z.string().min(1),
  email: z.string().email(),
  role: z.enum(["admin", "operator", "viewer"]),
  projectId: z.string().min(1),
  projectSlug: z.string().min(1),
});

export type SessionUser = z.infer<typeof sessionUserSchema>;

const MOCK_USER: SessionUser = {
  id: "mock-user",
  email: "operator@demo.local",
  role: "admin",
  projectId: "mock-project",
  projectSlug: "demo-project",
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
  // Mock tokens are a dev/demo convenience only. Once a real secret is
  // configured they must be rejected — otherwise `session=mock.x` grants
  // admin in production, bypassing the HMAC check entirely.
  if (token.startsWith("mock.")) {
    return isAuthConfigured() ? null : MOCK_USER;
  }

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
    return sessionUserSchema.parse(JSON.parse(Buffer.from(body, "base64url").toString("utf8")));
  } catch {
    return null;
  }
}

export function getSessionFromRequest(request: Request): SessionUser {
  return getVerifiedSessionFromRequest(request) ?? MOCK_USER;
}

export function getVerifiedSessionFromRequest(request: Request): SessionUser | null {
  const auth = request.headers.get("authorization");
  const cookie = request.headers.get("cookie");
  const bearer = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
  const cookieToken = cookie
    ?.split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith("session="))
    ?.split("=")[1];
  return verifySessionToken(bearer ?? cookieToken);
}

export { isAuthConfigured };

import { signSessionJwt, verifySessionJwt } from "@sangfor/auth";
import { z } from "zod";

import { getWebSessionJwtConfig, isAuthConfigured } from "@/lib/auth/config";
import { isLocalMockAuthProfile } from "@/lib/auth/runtime-profile";

const sessionUserSchema = z.object({
  id: z.string().min(1),
  email: z.string().email(),
  role: z.enum(["admin", "operator", "viewer"]),
  projectId: z.string().min(1),
  projectSlug: z.string().min(1),
});

export type SessionUser = z.infer<typeof sessionUserSchema>;

export class SessionAuthenticationError extends Error {
  readonly code = "UNAUTHENTICATED" as const;

  constructor() {
    super("A verified session is required");
    this.name = "SessionAuthenticationError";
  }
}

const MOCK_USER: SessionUser = {
  id: "mock-user",
  email: "operator@demo.local",
  role: "admin",
  projectId: "mock-project",
  projectSlug: "demo-project",
};

const DEMO_SESSION_EMAIL = "operator@demo.local";

// U013: the login route's deterministic default (real keyring configured =>
// "operator", demo/mock posture => "admin") for the initial issuance
// decision. @sangfor/web's role tier (admin|operator|viewer) is a coarse,
// pre-existing session concept distinct from BusinessRole/permissions
// (resolved from the DB in U015) — it rides the signed JWT as a
// non-authoritative `role` claim (see @sangfor/auth's session-jwt.ts) that
// only this module's own verify path reads back; API bearer verification
// never looks at it.
export function resolveWebSessionRole(): "admin" | "operator" {
  return isAuthConfigured() ? "operator" : "admin";
}

export function createSessionToken(user: SessionUser): string {
  const config = getWebSessionJwtConfig();
  return signSessionJwt(
    {
      sub: user.id,
      projectId: user.projectId,
      projectSlug: user.projectSlug,
      product: "portal",
      role: user.role,
    },
    config,
  );
}

export function verifySessionToken(token: string | null | undefined): SessionUser | null {
  if (!token) return null;
  // Mock tokens are a dev/demo convenience only. Once a real keyring is
  // configured they must be rejected — otherwise `session=mock.x` grants
  // admin in production, bypassing verification entirely.
  if (token.startsWith("mock.")) {
    return !isAuthConfigured() && isLocalMockAuthProfile() ? MOCK_USER : null;
  }

  let config;
  try {
    config = getWebSessionJwtConfig();
  } catch {
    return null;
  }

  const claims = verifySessionJwt(token, config);
  if (!claims || !claims.projectId || !claims.projectSlug) return null;

  const parsed = sessionUserSchema.safeParse({
    id: claims.sub,
    email: DEMO_SESSION_EMAIL,
    role: claims.role ?? resolveWebSessionRole(),
    projectId: claims.projectId,
    projectSlug: claims.projectSlug,
  });
  return parsed.success ? parsed.data : null;
}

export function getSessionFromRequest(request: Request): SessionUser {
  const session = getVerifiedSessionFromRequest(request);
  if (!session) throw new SessionAuthenticationError();
  return session;
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

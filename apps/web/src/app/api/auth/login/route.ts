import { SANGFOR_JWT_TTL_SECONDS } from "@sangfor/config";
import { z } from "zod";

import { AUTH_CONFIGURATION_UNAVAILABLE } from "@/lib/auth/config";
import { isLocalMockAuthProfile } from "@/lib/auth/runtime-profile";
import { isAuthConfigured, resolveWebSessionRole } from "@/lib/auth/session";
import { createPersistedSession, resolveActiveLocalPrincipal } from "@/lib/auth/persisted-session";
import { checkRateLimit, clientIp } from "@/lib/api-auth";
import { resolveDefaultProjectScope } from "@/lib/project-scope";
import { NextResponse } from "next/server";

const DEMO_EMAIL = "operator@demo.local";
// The synthetic local seed's explicitly `status="active"` principal (packages/db/prisma/seed.ts)
// — the only local identity this route may issue a persisted session for by default when a real
// USER_JWT_* keyring is configured. Distinct from DEMO_EMAIL, which stays the pre-existing
// unauthenticated-mock-mode display value and never reaches the DB.
const LOCAL_ACTIVE_PRINCIPAL_EMAIL = "operator@sangfor-os.local";
const loginBodySchema = z.object({
  email: z.string().optional(),
  password: z.string().optional(),
});

function demoPassword(): string | null {
  const password = process.env.AUTH_DEMO_PASSWORD?.trim();
  return password && password.length >= 8 ? password : null;
}

export async function POST(request: Request) {
  const jwtConfigured = isAuthConfigured();
  const localMockEnabled = isLocalMockAuthProfile();
  if (!jwtConfigured && !localMockEnabled) {
    return NextResponse.json(
      { error: AUTH_CONFIGURATION_UNAVAILABLE },
      { status: 503 },
    );
  }

  // IP-based rate limit to blunt credential stuffing / brute force.
  const { allowed, retryAfterSec } = checkRateLimit(`login:${clientIp(request)}`, {
    limit: 10,
    windowMs: 60_000,
  });
  if (!allowed) {
    return NextResponse.json(
      { error: "too_many_requests", message: "Too many login attempts. Try again later." },
      { status: 429, headers: { "Retry-After": String(retryAfterSec) } },
    );
  }

  const bodyResult = loginBodySchema.safeParse(
    await request.json().then(
      (value: unknown) => value,
      () => null,
    ),
  );
  if (!bodyResult.success) {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }

  const body = bodyResult.data;
  if (jwtConfigured) {
    const expected = demoPassword();
    if (!expected) {
      return NextResponse.json(
        { error: "AUTH_DEMO_PASSWORD must be set when the USER_JWT_* keyring is configured" },
        { status: 503 },
      );
    }
    const password = typeof body.password === "string" ? body.password : "";
    if (password !== expected) {
      return NextResponse.json({ error: "invalid credentials" }, { status: 401 });
    }
  }

  const email = jwtConfigured
    ? body.email?.length
      ? body.email
      : LOCAL_ACTIVE_PRINCIPAL_EMAIL
    : DEMO_EMAIL;
  const role = resolveWebSessionRole();
  let token = "mock.session";
  if (jwtConfigured) {
    const projectScope = await resolveDefaultProjectScope();
    if (!projectScope) {
      return NextResponse.json(
        { error: AUTH_CONFIGURATION_UNAVAILABLE },
        { status: 503 },
      );
    }

    // U014/SEC-01: resolves an existing, explicitly active local principal — never upserts an
    // arbitrary request email into an enabled user. A legacy NULL/legacy_pending or disabled row
    // gets no session even with a correct AUTH_DEMO_PASSWORD (no password-only fallback).
    const principal = await resolveActiveLocalPrincipal(email, projectScope.projectId);
    if (!principal) {
      return NextResponse.json({ error: "invalid credentials" }, { status: 401 });
    }

    const persisted = await createPersistedSession({
      userId: principal.userId,
      tenantId: principal.tenantId,
      companyId: principal.companyId,
      projectId: principal.projectId,
      projectSlug: projectScope.projectSlug,
      role,
    });
    token = persisted.token;
  }

  const response = NextResponse.json({
    token,
    authMode: jwtConfigured ? "jwt" : "mock",
    user: { email, role },
  });

  response.cookies.set("session", token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    // Bounded to the session JWT's own TTL — a cookie must never outlive the
    // token it carries (U013).
    maxAge: SANGFOR_JWT_TTL_SECONDS,
    // Opt-in because local production runs over plain http://localhost where
    // some browsers drop Secure cookies. Set SESSION_COOKIE_SECURE=1 when the
    // app is served behind HTTPS.
    secure: process.env.SESSION_COOKIE_SECURE === "1",
  });

  return response;
}

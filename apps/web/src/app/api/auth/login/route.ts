import { SANGFOR_JWT_TTL_SECONDS } from "@sangfor/config";
import { z } from "zod";

import { AUTH_CONFIGURATION_UNAVAILABLE } from "@/lib/auth/config";
import { isLocalMockAuthProfile } from "@/lib/auth/runtime-profile";
import { createSessionToken, isAuthConfigured, resolveWebSessionRole } from "@/lib/auth/session";
import { checkRateLimit, clientIp } from "@/lib/api-auth";
import { resolveDefaultProjectScope } from "@/lib/project-scope";
import { NextResponse } from "next/server";

const DEMO_EMAIL = "operator@demo.local";
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

  const email = jwtConfigured && body.email?.length ? body.email : DEMO_EMAIL;
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
    token = createSessionToken({
      id: "user-demo",
      email,
      role,
      projectId: projectScope.projectId,
      projectSlug: projectScope.projectSlug,
    });
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

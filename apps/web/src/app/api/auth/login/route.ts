import { createSessionToken, isAuthConfigured } from "@/lib/auth/session";
import { checkRateLimit, clientIp } from "@/lib/api-auth";
import { NextResponse } from "next/server";

const DEMO_EMAIL = "operator@demo.local";

function demoPassword(): string | null {
  const password = process.env.AUTH_DEMO_PASSWORD?.trim();
  return password && password.length >= 8 ? password : null;
}

export async function POST(request: Request) {
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

  const body = await request.json().catch(() => ({}));

  // WARNING: when JWT_SECRET is unset the service runs in "mock" mode and issues
  // an unauthenticated **admin** token to any caller. This is intended for
  // dev/demo only — a prod deploy that forgets to set JWT_SECRET would expose
  // admin access. `isAuthConfigured()` gates the real credential check below.
  if (!isAuthConfigured()) {
    console.warn(
      "[auth] JWT_SECRET not configured — issuing mock admin token (dev/demo only, unsafe for prod)",
    );
  }

  if (isAuthConfigured()) {
    const expected = demoPassword();
    if (!expected) {
      return NextResponse.json(
        { error: "AUTH_DEMO_PASSWORD must be set when JWT_SECRET is configured" },
        { status: 503 },
      );
    }
    const password = typeof body.password === "string" ? body.password : "";
    if (password !== expected) {
      return NextResponse.json({ error: "invalid credentials" }, { status: 401 });
    }
  }

  const email =
    typeof body.email === "string" && body.email.length > 0 ? body.email : DEMO_EMAIL;
  // Clients must never be allowed to set their own role.
  const role = isAuthConfigured() ? "operator" : "admin";

  const token = createSessionToken({
    id: "user-demo",
    email,
    role,
  });

  const response = NextResponse.json({
    token,
    authMode: isAuthConfigured() ? "jwt" : "mock",
    user: { email, role },
  });

  response.cookies.set("session", token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });

  return response;
}

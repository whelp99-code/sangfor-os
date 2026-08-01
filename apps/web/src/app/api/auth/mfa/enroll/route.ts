import { NextResponse } from "next/server";
import { z } from "zod";

import { checkRateLimit, clientIp } from "@/lib/api-auth";
import { beginTotpEnrollment, confirmTotpEnrollment, totpFactorStatus } from "@/lib/auth/mfa";
import { evaluatePersistedSessionFromRequest } from "@/lib/auth/persisted-session";
import { MFA_NOT_CONFIGURED, MfaNotConfiguredError } from "@/lib/auth/totp-seal";

export const dynamic = "force-dynamic";

const confirmSchema = z.object({ code: z.string().min(1).max(16) });

/**
 * Enrollment runs on an ordinary authenticated session by design: a user with no
 * factor yet cannot produce MFA, so requiring it here would make the feature
 * unreachable. Replacing an existing factor is refused by the service layer.
 */
async function requireSession(request: Request) {
  const evaluation = await evaluatePersistedSessionFromRequest(request);
  if (!evaluation.ok) {
    return { response: NextResponse.json({ error: "unauthorized", reason: evaluation.reason }, { status: 401 }) };
  }
  return { evaluation };
}

/** Current factor state, so the UI never has to guess. */
export async function GET(request: Request) {
  const gate = await requireSession(request);
  if (gate.response) return gate.response;
  return NextResponse.json(await totpFactorStatus(gate.evaluation.userId));
}

/** Issues a pending secret. */
export async function POST(request: Request) {
  const gate = await requireSession(request);
  if (gate.response) return gate.response;

  const { allowed, retryAfterSec } = checkRateLimit(`mfa-enroll:${clientIp(request)}`, {
    limit: 5,
    windowMs: 60_000,
  });
  if (!allowed) {
    return NextResponse.json({ error: "too_many_requests" }, { status: 429, headers: { "Retry-After": String(retryAfterSec) } });
  }

  try {
    const result = await beginTotpEnrollment(gate.evaluation.userId, gate.evaluation.userId);
    if ("ok" in result) return NextResponse.json({ error: "forbidden", reason: result.reason }, { status: 409 });
    // The secret is returned exactly once, at the moment it is created. It is
    // sealed in the database and can never be read back out through the API.
    return NextResponse.json({ secret: result.secretBase32, uri: result.uri }, { status: 201 });
  } catch (error) {
    if (error instanceof MfaNotConfiguredError) {
      return NextResponse.json({ error: MFA_NOT_CONFIGURED }, { status: 503 });
    }
    throw error;
  }
}

/** Activates the pending secret by proving a code from it. */
export async function PUT(request: Request) {
  const gate = await requireSession(request);
  if (gate.response) return gate.response;

  const { allowed, retryAfterSec } = checkRateLimit(`mfa-confirm:${gate.evaluation.userId}`, {
    limit: 10,
    windowMs: 60_000,
  });
  if (!allowed) {
    return NextResponse.json({ error: "too_many_requests" }, { status: 429, headers: { "Retry-After": String(retryAfterSec) } });
  }

  const parsed = confirmSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid request" }, { status: 400 });

  try {
    const result = await confirmTotpEnrollment(gate.evaluation.userId, parsed.data.code);
    if (!result.ok) return NextResponse.json({ error: "forbidden", reason: result.reason }, { status: 403 });
    return NextResponse.json({ enrolled: true });
  } catch (error) {
    if (error instanceof MfaNotConfiguredError) {
      return NextResponse.json({ error: MFA_NOT_CONFIGURED }, { status: 503 });
    }
    throw error;
  }
}

import { NextResponse } from "next/server";
import { z } from "zod";

import { checkRateLimit, clientIp } from "@/lib/api-auth";
import { isTotpRaceLost, verifyTotpForSession } from "@/lib/auth/mfa";
import { evaluatePersistedSessionFromRequest } from "@/lib/auth/persisted-session";
import { MFA_NOT_CONFIGURED, MfaNotConfiguredError } from "@/lib/auth/totp-seal";

export const dynamic = "force-dynamic";

const verifySchema = z.object({ code: z.string().min(1).max(16) });

/**
 * Step-up. Stamps the presented session as MFA-verified so privileged routes,
 * which demand evidence no older than PRIVILEGED_MFA_MAX_AGE_SECONDS, will admit
 * it for the next five minutes.
 *
 * The stamp lands on the presented jti and nothing else: MFA evidence is never
 * transferable between sessions.
 */
export async function POST(request: Request) {
  const evaluation = await evaluatePersistedSessionFromRequest(request);
  if (!evaluation.ok) {
    return NextResponse.json({ error: "unauthorized", reason: evaluation.reason }, { status: 401 });
  }

  // Per-user, not per-IP: the bound being defended is guesses against one
  // six-digit secret, and an attacker with a stolen cookie controls their own IP.
  const { allowed, retryAfterSec } = checkRateLimit(`mfa-verify:${evaluation.userId}`, {
    limit: 10,
    windowMs: 60_000,
  });
  if (!allowed) {
    return NextResponse.json({ error: "too_many_requests" }, { status: 429, headers: { "Retry-After": String(retryAfterSec) } });
  }

  const parsed = verifySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid request" }, { status: 400 });

  try {
    const result = await verifyTotpForSession(evaluation.userId, evaluation.sessionId, parsed.data.code);
    if (!result.ok) return NextResponse.json({ error: "forbidden", reason: result.reason }, { status: 403 });
    return NextResponse.json({ mfaVerified: true });
  } catch (error) {
    if (error instanceof MfaNotConfiguredError) {
      return NextResponse.json({ error: MFA_NOT_CONFIGURED }, { status: 503 });
    }
    if (isTotpRaceLost(error)) {
      // Another request spent this exact code first. Reported as a replay because
      // that is what it is from this caller's perspective.
      return NextResponse.json({ error: "forbidden", reason: "REPLAYED_CODE" }, { status: 403 });
    }
    throw error;
  }
}

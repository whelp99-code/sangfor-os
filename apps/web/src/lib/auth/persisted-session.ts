import { createHmac, randomUUID } from "node:crypto";

import { prisma } from "@sangfor/db";
import {
  computeHmacSignature,
  decodeJsonSegment,
  encodeBytesSegment,
  encodeJsonSegment,
  evaluateSession,
  signSessionJwt,
  verifySessionJwt,
  verifySignatureSegment,
  type SessionEvaluation,
  type SessionJwtClaims,
  type WebSessionRole,
} from "@sangfor/auth";

import { getWebSessionJwtConfig } from "./config";
import { extractSessionToken } from "./session";

export interface ActiveLocalPrincipal {
  readonly userId: string;
  readonly tenantId: string;
  readonly companyId: string;
  readonly projectId: string;
}

/**
 * Resolves an explicitly `status="active"` user by email, scoped to a caller-supplied project.
 * Returns `null` for: no matching row, a legacy NULL/`legacy_pending`/`disabled` row, or a
 * project whose company/tenant chain cannot be resolved. Never creates a User row — login must
 * not auto-upsert an arbitrary request email into an enabled principal.
 */
export async function resolveActiveLocalPrincipal(
  email: string,
  projectId: string,
): Promise<ActiveLocalPrincipal | null> {
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, status: true, disabledAt: true },
  });
  if (!user || user.status !== "active" || user.disabledAt !== null) return null;

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, companyId: true, company: { select: { tenantId: true } } },
  });
  if (!project || !project.companyId || !project.company) return null;

  const now = new Date();
  const [projectMembership, companyRole] = await Promise.all([
    prisma.projectMember.findFirst({
      where: {
        projectId: project.id,
        userId: user.id,
        status: "active",
        revokedAt: null,
        OR: [{ validFrom: null }, { validFrom: { lte: now } }],
        AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }],
      },
      select: { id: true },
    }),
    prisma.userCompanyRole.findFirst({
      where: {
        userId: user.id,
        companyId: project.companyId,
        status: "active",
        revokedAt: null,
        OR: [{ validFrom: null }, { validFrom: { lte: now } }],
        AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }],
      },
      select: { id: true },
    }),
  ]);
  if (!projectMembership || !companyRole) return null;

  return { userId: user.id, tenantId: project.company.tenantId, companyId: project.companyId, projectId: project.id };
}

export interface CreatePersistedSessionInput {
  readonly userId: string;
  readonly tenantId: string;
  readonly companyId: string;
  readonly projectId: string;
  readonly projectSlug: string;
  readonly role: WebSessionRole;
}

export interface CreatePersistedSessionResult {
  readonly token: string;
  readonly jti: string;
  readonly expiresAt: Date;
}

/**
 * Creates the AuthSession row and mints its bound JWT in one failure-atomic flow: the row is
 * inserted first, and the token is derived from — and only ever returned alongside — that same
 * row's `jti`/`expiresAt`. If the insert throws, no token is produced.
 */
export async function createPersistedSession(input: CreatePersistedSessionInput): Promise<CreatePersistedSessionResult> {
  const config = getWebSessionJwtConfig();
  const jti = randomUUID();
  const issuedAt = new Date();
  const nowSeconds = Math.floor(issuedAt.getTime() / 1000);
  const expiresAt = new Date((nowSeconds + config.ttlSeconds) * 1000);

  await prisma.authSession.create({
    data: {
      id: jti,
      userId: input.userId,
      tenantId: input.tenantId,
      companyId: input.companyId,
      projectId: input.projectId,
      issuedAt,
      expiresAt,
    },
  });

  const token = signSessionJwt(
    {
      sub: input.userId,
      jti,
      tenantId: input.tenantId,
      companyId: input.companyId,
      projectId: input.projectId,
      projectSlug: input.projectSlug,
      product: "portal",
      role: input.role,
      nowSeconds,
    },
    config,
  );

  return { token, jti, expiresAt };
}

function normalizedTokenScope(claims: SessionJwtClaims) {
  return {
    sub: claims.sub,
    jti: claims.jti,
    tenantId: claims.tenantId,
    companyId: claims.companyId,
    projectId: claims.projectId,
  };
}

/** Same DB round trip `evaluatePersistedSessionFromRequest` performs, factored out so a caller
 * that already has verified JWT claims (e.g. having just minted them at login) does not
 * re-parse/re-verify the token a second time. */
export async function evaluatePersistedSessionFromClaims(
  claims: SessionJwtClaims,
  now: Date = new Date(),
  requiredMfaAgeSeconds: number | null = null,
): Promise<SessionEvaluation> {
  const session = await prisma.authSession.findUnique({ where: { id: claims.jti } });
  const user = session
    ? await prisma.user.findUnique({ where: { id: session.userId }, select: { id: true, status: true, disabledAt: true } })
    : null;

  return evaluateSession(
    {
      token: normalizedTokenScope(claims),
      session,
      user,
    },
    now,
    requiredMfaAgeSeconds,
  );
}

/**
 * The one DB-backed verifier every adapter (Web Proxy, route handlers called directly in tests)
 * shares: extracts the token identically to `getVerifiedSessionFromRequest`, verifies it against
 * the same USER_JWT_* contract, then resolves the persisted session/user. Never trusts the
 * token's own claims about activeness — those come from `session`/`user`, fetched fresh here.
 */
export async function evaluatePersistedSessionFromRequest(
  request: Request,
  now: Date = new Date(),
  requiredMfaAgeSeconds: number | null = null,
): Promise<SessionEvaluation> {
  const token = extractSessionToken(request);
  if (!token) return { ok: false, reason: "NO_SESSION" };

  let config;
  try {
    config = getWebSessionJwtConfig();
  } catch {
    return { ok: false, reason: "NO_SESSION" };
  }

  const claims = verifySessionJwt(token, config, Math.floor(now.getTime() / 1000));
  if (!claims) return { ok: false, reason: "NO_SESSION" };

  return evaluatePersistedSessionFromClaims(claims, now, requiredMfaAgeSeconds);
}

/** Compare-and-set revoke: sets `revokedAt` only on a still-live row. Repeat calls with the same
 * `jti` are idempotent — the second call matches zero rows and still reports success. */
export async function revokeSession(jti: string): Promise<{ revoked: boolean }> {
  const result = await prisma.authSession.updateMany({
    where: { id: jti, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return { revoked: result.count > 0 };
}

// ---------------------------------------------------------------------------------------------
// Internal context: a signed, minimal fact envelope the Web Proxy forwards to route handlers
// after it has already run the DB-backed check above. Consumers (`assertApiAccess`) verify the
// signature synchronously — no second Prisma round trip per request — and MUST still fall back to
// their own independent JWT-only check whenever the header is absent (a direct-call unit test, or
// any request that reached a handler without crossing the Proxy), rather than treating its
// absence as automatic denial or automatic allow.
// ---------------------------------------------------------------------------------------------

export const INTERNAL_CONTEXT_HEADER = "x-sangfor-internal-context";
const INTERNAL_CONTEXT_MAX_AGE_SECONDS = 30;
const INTERNAL_CONTEXT_DOMAIN = "sangfor.internal-context/v1";

export interface InternalContextPayload {
  readonly userId: string;
  readonly tenantId: string;
  readonly companyId: string;
  readonly projectId: string;
  readonly mfaVerifiedAt: string | null;
  readonly iat: number;
}

function internalContextKey(activeSecret: Buffer): Buffer {
  // Domain-separated from the session-JWT signing key: same secret material, different derived
  // key, so an internal-context token can never be replayed as (or confused with) a session JWT.
  return createHmac("sha256", activeSecret).update(INTERNAL_CONTEXT_DOMAIN).digest();
}

/** Builds the signed, minimal internal-context header value from an `ok:true` evaluation. Never
 * carries the raw JWT or any client-supplied data — only server-resolved identity/scope/MFA
 * facts. */
export function signInternalContext(evaluation: Extract<SessionEvaluation, { ok: true }>): string {
  const config = getWebSessionJwtConfig();
  const payload: InternalContextPayload = {
    userId: evaluation.userId,
    tenantId: evaluation.tenantId,
    companyId: evaluation.companyId,
    projectId: evaluation.projectId,
    mfaVerifiedAt: evaluation.mfaVerifiedAt ? evaluation.mfaVerifiedAt.toISOString() : null,
    iat: Math.floor(Date.now() / 1000),
  };
  const segment = encodeJsonSegment(payload);
  const signature = encodeBytesSegment(computeHmacSignature(internalContextKey(config.active.secret), segment));
  return `${segment}.${signature}`;
}

/** Verifies a header value produced by `signInternalContext`. Rejects a missing/malformed/
 * tampered/stale value — this is the function `assertApiAccess` calls, never a bypass. */
export function verifyInternalContextHeader(value: string | null | undefined): InternalContextPayload | null {
  if (!value) return null;
  const parts = value.split(".");
  if (parts.length !== 2) return null;
  const [segment, signature] = parts;
  if (!segment || !signature) return null;

  let config;
  try {
    config = getWebSessionJwtConfig();
  } catch {
    return null;
  }

  if (!verifySignatureSegment(internalContextKey(config.active.secret), segment, signature)) return null;

  const decoded = decodeJsonSegment(segment);
  if (!decoded.ok) return null;
  const payload = decoded.value as Partial<InternalContextPayload>;
  if (
    typeof payload.userId !== "string" ||
    typeof payload.tenantId !== "string" ||
    typeof payload.companyId !== "string" ||
    typeof payload.projectId !== "string" ||
    typeof payload.iat !== "number" ||
    (payload.mfaVerifiedAt !== null && typeof payload.mfaVerifiedAt !== "string")
  ) {
    return null;
  }

  const ageSeconds = Math.floor(Date.now() / 1000) - payload.iat;
  if (ageSeconds < 0 || ageSeconds > INTERNAL_CONTEXT_MAX_AGE_SECONDS) return null;

  return payload as InternalContextPayload;
}

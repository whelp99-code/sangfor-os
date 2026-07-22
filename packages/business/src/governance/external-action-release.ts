/** U027/OPS-01 root-only, exact-version external-action release authority. */
import { createHash, createHmac, randomBytes as nodeRandomBytes, timingSafeEqual } from "node:crypto";
import { TextDecoder } from "node:util";

import type { Prisma } from "@sangfor/db";

import type { ApprovalKernelCaller } from "./approval-kernel";
import { deriveChainScopeKey } from "./audit-chain";

type TxClient = Prisma.TransactionClient;
const B64URL = /^[A-Za-z0-9_-]+$/;
const KID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const RECEIPT_TYP = "sangfor-external-action-receipt+jwt";
const RECEIPT_VERSION = "sangfor.external-action-receipt/v1";
const RECEIPT_ISSUER = "sangfor-web-external-action-release";
const RECEIPT_AUDIENCE = "sangfor-engineer-mcp-external-action";
const RECEIPT_TTL_SECONDS = 60;
const CLOCK_SKEW_SECONDS = 5;

export type ExternalActionReleaseErrorCode =
  | "EXTERNAL_ACTION_RECEIPT_INVALID"
  | "EXTERNAL_ACTION_RECEIPT_REPLAY"
  | "EXTERNAL_ACTION_IDEMPOTENCY_CONFLICT"
  | "EXTERNAL_ACTION_RECEIPT_TERMINAL"
  | "EXTERNAL_ACTION_RELEASE_DENIED";

export class ExternalActionReleaseError extends Error {
  readonly httpStatus: 401 | 403 | 409 | 422;
  constructor(readonly code: ExternalActionReleaseErrorCode, message: string, status?: 401 | 403 | 409 | 422) {
    super(message); this.name = "ExternalActionReleaseError";
    this.httpStatus = status ?? (code === "EXTERNAL_ACTION_RECEIPT_INVALID" ? 401 : code === "EXTERNAL_ACTION_RELEASE_DENIED" ? 403 : 409);
  }
}
function fail(code: ExternalActionReleaseErrorCode, message: string, status?: 401 | 403 | 409 | 422): never { throw new ExternalActionReleaseError(code, message, status); }

/** Narrow RFC8785/JCS serializer: protocol inputs are JSON-only and sorted by Unicode code point. */
export function canonicalizeExternalActionJson(value: unknown): string {
  const quote = (text: string) => {
    let out = '"';
    for (let i = 0; i < text.length; i += 1) {
      const char = text[i]!; const code = text.charCodeAt(i);
      if (char === '"') out += '\\"'; else if (char === "\\") out += "\\\\";
      else if (code === 8) out += "\\b"; else if (code === 9) out += "\\t"; else if (code === 10) out += "\\n";
      else if (code === 12) out += "\\f"; else if (code === 13) out += "\\r";
      else if (code < 0x20) out += `\\u${code.toString(16).padStart(4, "0")}`; else out += char;
    }
    return `${out}"`;
  };
  const canon = (item: unknown): string => {
    if (item === null) return "null";
    if (item === true || item === false) return String(item);
    if (typeof item === "number") { if (!Number.isFinite(item)) fail("EXTERNAL_ACTION_RECEIPT_INVALID", "non-finite JSON value", 422); return String(item); }
    if (typeof item === "string") return quote(item);
    if (Array.isArray(item)) return `[${item.map(canon).join(",")}]`;
    if (item && typeof item === "object") return `{${Object.keys(item as Record<string, unknown>).sort().map(key => `${quote(key)}:${canon((item as Record<string, unknown>)[key])}`).join(",")}}`;
    fail("EXTERNAL_ACTION_RECEIPT_INVALID", "non-JSON canonical value", 422);
  };
  return canon(value);
}
export function externalActionCanonicalHash(value: unknown): string { return createHash("sha256").update(canonicalizeExternalActionJson(value), "utf8").digest("hex"); }

type ReceiptKey = Readonly<{ secret: Buffer; status: "sign_verify" | "verify_only"; signingDisabledAt: number | null }>;
export interface ExternalActionReceiptConfig { readonly activeKeyId: string; readonly keys: ReadonlyMap<string, ReceiptKey>; }
export interface ExternalActionReceiptConfigEnv { readonly EXTERNAL_ACTION_RECEIPT_ACTIVE_KEY_ID?: string; readonly EXTERNAL_ACTION_RECEIPT_KEYS_JSON?: string; }
function decodeSecret(value: unknown): Buffer {
  if (typeof value !== "string" || !B64URL.test(value)) fail("EXTERNAL_ACTION_RECEIPT_INVALID", "receipt key must be canonical unpadded base64url", 422);
  const bytes = Buffer.from(value, "base64url");
  if (bytes.toString("base64url") !== value || bytes.length < 32 || bytes.length > 64) fail("EXTERNAL_ACTION_RECEIPT_INVALID", "receipt key must decode to 32-64 bytes", 422);
  return bytes;
}
export function parseExternalActionReceiptConfig(env: ExternalActionReceiptConfigEnv = process.env as ExternalActionReceiptConfigEnv, now = Math.floor(Date.now() / 1000)): ExternalActionReceiptConfig {
  const activeKeyId = env.EXTERNAL_ACTION_RECEIPT_ACTIVE_KEY_ID?.trim();
  if (!activeKeyId || !KID.test(activeKeyId)) fail("EXTERNAL_ACTION_RECEIPT_INVALID", "invalid active receipt key id", 422);
  let parsed: unknown; try { parsed = JSON.parse(env.EXTERNAL_ACTION_RECEIPT_KEYS_JSON ?? ""); } catch { fail("EXTERNAL_ACTION_RECEIPT_INVALID", "invalid receipt key JSON", 422); }
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") fail("EXTERNAL_ACTION_RECEIPT_INVALID", "receipt key JSON must be an object", 422);
  const keys = new Map<string, ReceiptKey>(); let activeCount = 0;
  for (const [kid, raw] of Object.entries(parsed as Record<string, unknown>)) {
    if (!KID.test(kid) || !raw || Array.isArray(raw) || typeof raw !== "object") fail("EXTERNAL_ACTION_RECEIPT_INVALID", "invalid receipt key entry", 422);
    const entry = raw as Record<string, unknown>; const entryKeys = Object.keys(entry).sort();
    if (entryKeys.join(",") !== "secret,signingDisabledAt,status" || (entry.status !== "sign_verify" && entry.status !== "verify_only")) fail("EXTERNAL_ACTION_RECEIPT_INVALID", "invalid receipt key shape", 422);
    const signingDisabledAt = entry.signingDisabledAt;
    if (entry.status === "sign_verify") { if (signingDisabledAt !== null) fail("EXTERNAL_ACTION_RECEIPT_INVALID", "active receipt key cannot be disabled", 422); activeCount += 1; }
    else if (!Number.isSafeInteger(signingDisabledAt) || (signingDisabledAt as number) <= 0 || now > (signingDisabledAt as number) + 65) fail("EXTERNAL_ACTION_RECEIPT_INVALID", "verify-only key is outside its retention window", 422);
    keys.set(kid, { secret: decodeSecret(entry.secret), status: entry.status, signingDisabledAt: signingDisabledAt as number | null });
  }
  const active = keys.get(activeKeyId);
  if (activeCount !== 1 || !active || active.status !== "sign_verify") fail("EXTERNAL_ACTION_RECEIPT_INVALID", "exactly one active receipt key is required", 422);
  return { activeKeyId, keys };
}

export interface ExternalActionReceiptClaims {
  readonly action: string; readonly actorAssignmentId: string; readonly actorUserId: string; readonly approvalId: string; readonly approvalRevision: number;
  readonly artifactId: string; readonly artifactVersionId: string; readonly artifactVersionNumber: number; readonly aud: typeof RECEIPT_AUDIENCE;
  readonly bodyHash: string; readonly companyId: string; readonly exp: number; readonly iat: number; readonly idempotencyKey: string; readonly iss: typeof RECEIPT_ISSUER;
  readonly jti: string; readonly nbf: number; readonly nonce: string; readonly policyHash: string; readonly projectId: string; readonly receiptVersion: typeof RECEIPT_VERSION;
  readonly target: string; readonly tenantId: string;
}
export type ExternalActionReceiptInput = Omit<ExternalActionReceiptClaims, "iat" | "nbf" | "exp" | "jti" | "nonce" | "aud" | "iss" | "receiptVersion">;
const CLAIM_KEYS = ["action", "actorAssignmentId", "actorUserId", "approvalId", "approvalRevision", "artifactId", "artifactVersionId", "artifactVersionNumber", "aud", "bodyHash", "companyId", "exp", "iat", "idempotencyKey", "iss", "jti", "nbf", "nonce", "policyHash", "projectId", "receiptVersion", "target", "tenantId"] as const;
function random128(random: () => Buffer): string { const bytes = random(); if (!Buffer.isBuffer(bytes) || bytes.length !== 16) fail("EXTERNAL_ACTION_RECEIPT_INVALID", "random source must return 128 bits", 422); return bytes.toString("base64url"); }
function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean { const actual = Object.keys(value).sort(); return actual.length === expected.length && actual.every((key, index) => key === [...expected].sort()[index]); }
function decodeJcs(segment: string, name: string): Record<string, unknown> {
  if (!B64URL.test(segment)) fail("EXTERNAL_ACTION_RECEIPT_INVALID", `${name} is not unpadded base64url`);
  const bytes = Buffer.from(segment, "base64url"); if (bytes.toString("base64url") !== segment) fail("EXTERNAL_ACTION_RECEIPT_INVALID", `${name} base64url is not canonical`);
  let source: string; try { source = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { fail("EXTERNAL_ACTION_RECEIPT_INVALID", `${name} is not UTF-8`); }
  let parsed: unknown; try { parsed = JSON.parse(source); } catch { fail("EXTERNAL_ACTION_RECEIPT_INVALID", `${name} is invalid JSON`); }
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object" || source !== canonicalizeExternalActionJson(parsed)) fail("EXTERNAL_ACTION_RECEIPT_INVALID", `${name} is not canonical JCS`);
  return parsed as Record<string, unknown>;
}
function validatedClaims(value: Record<string, unknown>, now: number): ExternalActionReceiptClaims {
  if (!exactKeys(value, CLAIM_KEYS)) fail("EXTERNAL_ACTION_RECEIPT_INVALID", "receipt payload keys drift");
  const stringKeys = ["action", "actorAssignmentId", "actorUserId", "approvalId", "artifactId", "artifactVersionId", "aud", "bodyHash", "companyId", "idempotencyKey", "iss", "jti", "nonce", "policyHash", "projectId", "receiptVersion", "target", "tenantId"] as const;
  for (const key of stringKeys) if (typeof value[key] !== "string" || value[key].length === 0) fail("EXTERNAL_ACTION_RECEIPT_INVALID", `invalid ${key}`);
  if (value.aud !== RECEIPT_AUDIENCE || value.iss !== RECEIPT_ISSUER || value.receiptVersion !== RECEIPT_VERSION || !SHA256.test(value.bodyHash as string) || !SHA256.test(value.policyHash as string)) fail("EXTERNAL_ACTION_RECEIPT_INVALID", "receipt identity or hashes mismatch");
  for (const key of ["approvalRevision", "artifactVersionNumber", "iat", "nbf", "exp"] as const) if (!Number.isSafeInteger(value[key])) fail("EXTERNAL_ACTION_RECEIPT_INVALID", `invalid ${key}`);
  const iat = value.iat as number; const nbf = value.nbf as number; const exp = value.exp as number;
  if (nbf !== iat - CLOCK_SKEW_SECONDS || exp !== iat + RECEIPT_TTL_SECONDS || now < nbf || now > exp) fail("EXTERNAL_ACTION_RECEIPT_INVALID", "receipt lifetime or skew mismatch");
  for (const key of ["jti", "nonce"] as const) { const id = value[key] as string; if (id.length !== 22 || !B64URL.test(id) || Buffer.from(id, "base64url").length !== 16) fail("EXTERNAL_ACTION_RECEIPT_INVALID", `invalid ${key}`); }
  return value as unknown as ExternalActionReceiptClaims;
}
function sign(claims: ExternalActionReceiptClaims, kid: string, key: ReceiptKey): string {
  const header = Buffer.from(canonicalizeExternalActionJson({ alg: "HS256", kid, typ: RECEIPT_TYP, v: 1 }), "utf8").toString("base64url");
  const payload = Buffer.from(canonicalizeExternalActionJson(claims), "utf8").toString("base64url");
  return `${header}.${payload}.${createHmac("sha256", key.secret).update(`${header}.${payload}`, "utf8").digest("base64url")}`;
}
export function issueExternalActionReceipt(input: ExternalActionReceiptInput, config: ExternalActionReceiptConfig, options: { now?: number; randomBytes?: () => Buffer } = {}): string {
  const now = options.now ?? Math.floor(Date.now() / 1000); if (!Number.isSafeInteger(now)) fail("EXTERNAL_ACTION_RECEIPT_INVALID", "clock must be safe integer", 422);
  for (const [key, value] of Object.entries(input)) if (typeof value === "string" && value.length === 0) fail("EXTERNAL_ACTION_RECEIPT_INVALID", `${key} is required`, 422);
  if (!SHA256.test(input.bodyHash) || !SHA256.test(input.policyHash) || !Number.isSafeInteger(input.approvalRevision) || !Number.isSafeInteger(input.artifactVersionNumber)) fail("EXTERNAL_ACTION_RECEIPT_INVALID", "invalid receipt input", 422);
  const random = options.randomBytes ?? (() => nodeRandomBytes(16)); const key = config.keys.get(config.activeKeyId);
  if (!key || key.status !== "sign_verify") fail("EXTERNAL_ACTION_RECEIPT_INVALID", "active signing key unavailable", 422);
  return sign({ ...input, iss: RECEIPT_ISSUER, aud: RECEIPT_AUDIENCE, receiptVersion: RECEIPT_VERSION, iat: now, nbf: now - CLOCK_SKEW_SECONDS, exp: now + RECEIPT_TTL_SECONDS, jti: random128(random), nonce: random128(random) }, config.activeKeyId, key);
}
export function verifyExternalActionReceipt(receipt: string, config: ExternalActionReceiptConfig, now = Math.floor(Date.now() / 1000)): ExternalActionReceiptClaims {
  if (!Number.isSafeInteger(now)) fail("EXTERNAL_ACTION_RECEIPT_INVALID", "clock must be safe integer"); const segments = receipt.split(".");
  if (segments.length !== 3 || segments.some(part => !part)) fail("EXTERNAL_ACTION_RECEIPT_INVALID", "receipt must be compact JWS");
  const [headerSegment, payloadSegment, signatureSegment] = segments as [string, string, string]; const header = decodeJcs(headerSegment, "header");
  if (!exactKeys(header, ["alg", "kid", "typ", "v"]) || header.alg !== "HS256" || header.typ !== RECEIPT_TYP || header.v !== 1 || typeof header.kid !== "string" || !KID.test(header.kid)) fail("EXTERNAL_ACTION_RECEIPT_INVALID", "receipt header mismatch");
  const claims = validatedClaims(decodeJcs(payloadSegment, "payload"), now); const key = config.keys.get(header.kid);
  if (!key || (key.status === "verify_only" && (!(key.signingDisabledAt && claims.iat <= key.signingDisabledAt) || now > key.signingDisabledAt + 65))) fail("EXTERNAL_ACTION_RECEIPT_INVALID", "receipt key is not valid");
  if (!B64URL.test(signatureSegment)) fail("EXTERNAL_ACTION_RECEIPT_INVALID", "signature is not unpadded base64url"); const actual = Buffer.from(signatureSegment, "base64url");
  if (actual.toString("base64url") !== signatureSegment) fail("EXTERNAL_ACTION_RECEIPT_INVALID", "signature is non-canonical"); const expected = createHmac("sha256", key.secret).update(`${headerSegment}.${payloadSegment}`, "utf8").digest();
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) fail("EXTERNAL_ACTION_RECEIPT_INVALID", "signature mismatch"); return claims;
}

export interface ExternalActionReleaseInput { readonly action: string; readonly target: string; readonly artifactVersionId: string; readonly approvalId: string; readonly bodyHash: string; readonly idempotencyKey: string; }
export interface IssuedExternalActionRelease { readonly receipt: string; readonly claims: ExternalActionReceiptClaims; readonly idempotentReplay: boolean; }
function scope(caller: ApprovalKernelCaller) { return { ...caller.scope, level: "PROJECT" as const }; }
function validInput(input: ExternalActionReleaseInput): void { for (const [key, value] of Object.entries(input)) if (typeof value !== "string" || value.length === 0) fail("EXTERNAL_ACTION_RELEASE_DENIED", `${key} is required`, 422); if (!SHA256.test(input.bodyHash)) fail("EXTERNAL_ACTION_RELEASE_DENIED", "bodyHash must be server-canonical SHA-256", 422); }
async function actorAssignment(tx: TxClient, caller: ApprovalKernelCaller): Promise<string> { const now = new Date(); const rows = await tx.userCompanyRole.findMany({ where: { userId: caller.userId, companyId: caller.scope.companyId, status: "active", revokedAt: null, validFrom: { lte: now }, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }, select: { id: true } }); if (rows.length !== 1) fail("EXTERNAL_ACTION_RELEASE_DENIED", "exactly one active actor assignment is required"); return rows[0]!.id; }
async function evaluateCurrentRelease(input: { action: string; artifactVersionId: string; approvalId: string }, caller: ApprovalKernelCaller, tx: TxClient) {
  // Kept behind the U023 boundary so receipt-only unit tests do not load the
  // application auth package; runtime authority still comes only from U023.
  const { evaluateArtifactRelease } = await import("./artifact-release");
  return evaluateArtifactRelease(input, caller, tx);
}
async function appendCurrentAudit(tx: TxClient, input: Parameters<typeof import("./audit-db").appendAuditEvent>[1]) {
  const { appendAuditEvent } = await import("./audit-db");
  return appendAuditEvent(tx, input);
}
async function rootPrisma() { return (await import("@sangfor/db")).prisma; }
async function issueWithClient(input: ExternalActionReleaseInput, caller: ApprovalKernelCaller, config: ExternalActionReceiptConfig, tx: TxClient): Promise<IssuedExternalActionRelease> {
  validInput(input); const release = await evaluateCurrentRelease({ action: input.action, artifactVersionId: input.artifactVersionId, approvalId: input.approvalId }, caller, tx);
  if (!release.releasable) fail("EXTERNAL_ACTION_RELEASE_DENIED", release.reasonCode);
  const existing = await tx.auditLog.findFirst({ where: { chainScopeKey: deriveChainScopeKey(scope(caller)), idempotencyKey: `external-action.issue:${input.idempotencyKey}` }, select: { details: true } });
  const inputHash = externalActionCanonicalHash({ ...input, caller: { userId: caller.userId, scope: caller.scope } });
  if (existing) {
    const detail = existing.details as Record<string, unknown> | null;
    if (!detail || detail.inputHash !== inputHash || typeof detail.receipt !== "string") fail("EXTERNAL_ACTION_IDEMPOTENCY_CONFLICT", "external action idempotency key is bound to different input");
    const claims = verifyExternalActionReceipt(detail.receipt, config); return { receipt: detail.receipt, claims, idempotentReplay: true };
  }
  const approval = await tx.approvalRequest.findUnique({ where: { id: input.approvalId }, select: { revision: true, policyHash: true } });
  const version = await tx.artifactVersion.findUnique({ where: { id: input.artifactVersionId }, select: { version: true } });
  if (!approval || !version) fail("EXTERNAL_ACTION_RELEASE_DENIED", "release provenance disappeared");
  if (approval.policyHash === null) fail("EXTERNAL_ACTION_RELEASE_DENIED", "external action requires a canonical policy-bound approval");
  const raw = issueExternalActionReceipt({ action: input.action, actorAssignmentId: await actorAssignment(tx, caller), actorUserId: caller.userId, approvalId: input.approvalId, approvalRevision: approval.revision, artifactId: release.artifactId, artifactVersionId: input.artifactVersionId, artifactVersionNumber: version.version, bodyHash: input.bodyHash, companyId: caller.scope.companyId, idempotencyKey: input.idempotencyKey, policyHash: approval.policyHash, projectId: caller.scope.projectId, target: input.target, tenantId: caller.scope.tenantId }, config);
  const claims = verifyExternalActionReceipt(raw, config); const appended = await appendCurrentAudit(tx, { scope: scope(caller), eventType: "external_action.issue", actorId: caller.userId, resourceType: "external_action_receipt", resourceId: claims.jti, idempotencyKey: `external-action.issue:${input.idempotencyKey}`, details: { inputHash, receipt: raw } });
  if (appended.idempotent) fail("EXTERNAL_ACTION_IDEMPOTENCY_CONFLICT", "concurrent issuance must be retried"); return { receipt: raw, claims, idempotentReplay: false };
}
export async function issueExternalActionRelease(input: ExternalActionReleaseInput, caller: ApprovalKernelCaller, config = parseExternalActionReceiptConfig(), tx?: TxClient): Promise<IssuedExternalActionRelease> { if (tx) return issueWithClient(input, caller, config, tx); return (await rootPrisma()).$transaction((client: TxClient) => issueWithClient(input, caller, config, client)); }

export interface ConsumedExternalActionRelease { readonly claims: ExternalActionReceiptClaims; }
async function consumeWithClient(receipt: string, caller: ApprovalKernelCaller, config: ExternalActionReceiptConfig, tx: TxClient): Promise<ConsumedExternalActionRelease> {
  const claims = verifyExternalActionReceipt(receipt, config);
  if (claims.tenantId !== caller.scope.tenantId || claims.companyId !== caller.scope.companyId || claims.projectId !== caller.scope.projectId) fail("EXTERNAL_ACTION_RELEASE_DENIED", "receipt scope does not match principal");
  const release = await evaluateCurrentRelease({ action: claims.action, artifactVersionId: claims.artifactVersionId, approvalId: claims.approvalId }, caller, tx);
  if (!release.releasable || release.artifactId !== claims.artifactId) fail("EXTERNAL_ACTION_RELEASE_DENIED", "release receipt is stale");
  const approval = await tx.approvalRequest.findUnique({ where: { id: claims.approvalId }, select: { revision: true, policyHash: true } }); const version = await tx.artifactVersion.findUnique({ where: { id: claims.artifactVersionId }, select: { version: true } });
  if (!approval || !version || approval.revision !== claims.approvalRevision || approval.policyHash !== claims.policyHash || version.version !== claims.artifactVersionNumber) fail("EXTERNAL_ACTION_RELEASE_DENIED", "receipt provenance is stale");
  const values: Array<[string, string]> = [["jti", claims.jti], ["nonce", claims.nonce], ["idempotency", claims.idempotencyKey]];
  for (const [kind, value] of values) { const appended = await appendCurrentAudit(tx, { scope: scope(caller), eventType: "external_action.consume", actorId: claims.actorUserId, resourceType: "external_action_receipt", resourceId: claims.jti, idempotencyKey: `external-action.consume:${kind}:${value}`, details: { action: claims.action, artifactVersionId: claims.artifactVersionId, approvalId: claims.approvalId } }); if (appended.idempotent) fail("EXTERNAL_ACTION_RECEIPT_REPLAY", `receipt ${kind} was already consumed`); }
  return { claims };
}
export async function consumeExternalActionRelease(receipt: string, caller: ApprovalKernelCaller, config = parseExternalActionReceiptConfig(), tx?: TxClient): Promise<ConsumedExternalActionRelease> { if (tx) return consumeWithClient(receipt, caller, config, tx); return (await rootPrisma()).$transaction((client: TxClient) => consumeWithClient(receipt, caller, config, client)); }

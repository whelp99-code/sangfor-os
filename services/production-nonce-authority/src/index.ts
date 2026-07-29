import { DurableObject } from "cloudflare:workers";

const CONSUME_PATH = "/v1/production-nonces/consume";
const MAX_BODY_BYTES = 4096;
const MAX_IDENTIFIER_LENGTH = 256;
const EXPECTED_KEYS = new Set(["schemaVersion", "issuer", "nonce", "approvalId", "candidateSha", "runId", "receiptSha256"]);
const NONCE_PATTERN = /^[A-Za-z0-9._-]{32,128}$/u;
const SHA40_PATTERN = /^[a-f0-9]{40}$/u;
const SHA64_PATTERN = /^[a-f0-9]{64}$/u;

export interface Env {
  APPROVAL_ISSUER: string;
  NONCE_CONSUME_BEARER_TOKEN: string;
  PRODUCTION_NONCE_CONSUMER: DurableObjectNamespace<ProductionNonceConsumer>;
}

interface ConsumeRequest {
  schemaVersion: 1;
  issuer: string;
  nonce: string;
  approvalId: string;
  candidateSha: string;
  runId: string;
  receiptSha256: string;
}

interface ConsumptionResult {
  consumed: boolean;
}

function response(status: number, value: Record<string, unknown>): Response {
  return Response.json(value, { status, headers: { "cache-control": "no-store" } });
}

function isBoundedNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_IDENTIFIER_LENGTH;
}

function isValidRequest(value: unknown): value is ConsumeRequest {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== EXPECTED_KEYS.size || keys.some((key) => !EXPECTED_KEYS.has(key))) return false;
  return record.schemaVersion === 1
    && typeof record.issuer === "string"
    && NONCE_PATTERN.test(record.nonce as string)
    && isBoundedNonEmptyString(record.approvalId)
    && SHA40_PATTERN.test(record.candidateSha as string)
    && isBoundedNonEmptyString(record.runId)
    && SHA64_PATTERN.test(record.receiptSha256 as string);
}

async function readBodyWithinLimit(request: Request): Promise<string | null> {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null && (!/^[0-9]+$/u.test(contentLength) || Number(contentLength) > MAX_BODY_BYTES)) return null;
  if (request.body === null) return null;

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_BODY_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

async function hasValidBearer(request: Request, expectedToken: string): Promise<boolean> {
  if (expectedToken.length < 32) return false;
  const authorization = request.headers.get("authorization");
  const suppliedToken = authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : "";
  const encoder = new TextEncoder();
  const [expectedDigest, suppliedDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(expectedToken)),
    crypto.subtle.digest("SHA-256", encoder.encode(suppliedToken)),
  ]);
  const expectedBytes = new Uint8Array(expectedDigest);
  const suppliedBytes = new Uint8Array(suppliedDigest);
  let difference = 0;
  for (let index = 0; index < expectedBytes.length; index += 1) difference |= expectedBytes[index] ^ suppliedBytes[index];
  return difference === 0;
}

export class ProductionNonceConsumer extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS consumed_nonces (
        nonce TEXT PRIMARY KEY,
        approval_id TEXT NOT NULL,
        candidate_sha TEXT NOT NULL,
        run_id TEXT NOT NULL,
        receipt_sha256 TEXT NOT NULL,
        consumed_at INTEGER NOT NULL
      )
    `);
  }

  consume(request: ConsumeRequest): ConsumptionResult {
    const inserted = this.ctx.storage.sql.exec<{ nonce: string }>(
      `INSERT INTO consumed_nonces (nonce, approval_id, candidate_sha, run_id, receipt_sha256, consumed_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(nonce) DO NOTHING
       RETURNING nonce`,
      request.nonce,
      request.approvalId,
      request.candidateSha,
      request.runId,
      request.receiptSha256,
      Date.now(),
    );
    return { consumed: inserted.toArray().length === 1 };
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== CONSUME_PATH) return response(404, { error: "NOT_FOUND" });
    if (request.method !== "POST") return response(405, { error: "METHOD_NOT_ALLOWED" });
    if (!(await hasValidBearer(request, env.NONCE_CONSUME_BEARER_TOKEN))) return response(401, { error: "UNAUTHORIZED" });

    const body = await readBodyWithinLimit(request);
    if (body === null) return response(400, { error: "INVALID_REQUEST" });
    let candidate: unknown;
    try {
      candidate = JSON.parse(body);
    } catch {
      return response(400, { error: "INVALID_REQUEST" });
    }
    if (!isValidRequest(candidate) || candidate.issuer !== env.APPROVAL_ISSUER) return response(400, { error: "INVALID_REQUEST" });

    const result = await env.PRODUCTION_NONCE_CONSUMER.getByName(env.APPROVAL_ISSUER).consume(candidate);
    if (!result.consumed) return response(409, { schemaVersion: 1, consumed: false });
    return response(201, {
      schemaVersion: 1,
      consumed: true,
      receiptSha256: candidate.receiptSha256,
      nonce: candidate.nonce,
    });
  },
} satisfies ExportedHandler<Env>;

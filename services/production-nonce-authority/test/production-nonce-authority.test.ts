import { reset, runInDurableObject, SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

const token = "test-only-nonce-consume-token-0123456789abcdef";
const issuer = "sangfor.production-approval";

function payload(nonce = "a".repeat(32)) {
  return {
    schemaVersion: 1,
    issuer,
    nonce,
    approvalId: "approval-123",
    candidateSha: "b".repeat(40),
    runId: "run-123",
    receiptSha256: "c".repeat(64),
  };
}

function uniqueNonce(label: string) {
  return `${label}-${crypto.randomUUID().replaceAll("-", "")}`;
}

function consume(body: unknown, options: { token?: string; method?: string; path?: string } = {}) {
  const method = options.method ?? "POST";
  const init: RequestInit = {
    method,
    headers: {
      authorization: `Bearer ${options.token ?? token}`,
      "content-type": "application/json",
    },
  };
  if (method !== "GET" && method !== "HEAD") init.body = JSON.stringify(body);
  return SELF.fetch(`https://nonce-authority.test${options.path ?? "/v1/production-nonces/consume"}`, init);
}

function rawConsume(body: string) {
  return SELF.fetch("https://nonce-authority.test/v1/production-nonces/consume", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body,
  });
}

describe("production nonce authority", () => {
  beforeEach(async () => {
    await reset();
  });

  it("accepts a nonce once and rejects its replay without changing the first response contract", async () => {
    const body = payload(uniqueNonce("first"));
    const first = await consume(body);
    expect(first.status).toBe(201);
    await expect(first.json()).resolves.toEqual({ schemaVersion: 1, consumed: true, receiptSha256: body.receiptSha256, nonce: body.nonce });

    const replay = await consume({ ...body, receiptSha256: "d".repeat(64) });
    expect(replay.status).toBe(409);
    await expect(replay.json()).resolves.toEqual({ schemaVersion: 1, consumed: false });
    const stored = await runInDurableObject(env.PRODUCTION_NONCE_CONSUMER.getByName(issuer), (_instance, state) => state.storage.sql.exec<{ receipt_sha256: string }>("SELECT receipt_sha256 FROM consumed_nonces WHERE nonce = ?", body.nonce).one());
    expect(stored.receipt_sha256).toBe(body.receiptSha256);
  });

  it("serializes concurrent duplicate consumption to one success and conflicts for the rest", async () => {
    const body = payload(uniqueNonce("concurrent"));
    const responses = await Promise.all(Array.from({ length: 12 }, () => consume(body)));
    const statuses = responses.map(({ status }) => status);
    expect(statuses.filter((status) => status === 201)).toHaveLength(1);
    expect(statuses.filter((status) => status === 409)).toHaveLength(11);
  });

  it("rejects invalid tokens and wrong issuers", async () => {
    expect((await consume(payload(uniqueNonce("token")), { token: "wrong" })).status).toBe(401);
    expect((await consume({ ...payload(uniqueNonce("issuer")), issuer: "other-issuer" })).status).toBe(400);
  });

  it("rejects malformed and unknown request fields", async () => {
    expect((await consume({ ...payload(uniqueNonce("unknown")), unexpected: true })).status).toBe(400);
    expect((await consume({ ...payload(uniqueNonce("malformed")), candidateSha: "ABC" })).status).toBe(400);
    expect((await consume("not-an-object")).status).toBe(400);
    expect((await rawConsume("{")).status).toBe(400);
    expect((await rawConsume("x".repeat(4097))).status).toBe(400);
  });

  it("returns method and path errors before processing a request", async () => {
    expect((await consume(payload(uniqueNonce("method")), { method: "GET" })).status).toBe(405);
    expect((await consume(payload(uniqueNonce("path")), { path: "/v1/production-nonces" })).status).toBe(404);
  });
});

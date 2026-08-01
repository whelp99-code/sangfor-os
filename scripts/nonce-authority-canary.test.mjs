import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CanaryError, runCanary } from "./nonce-authority-canary.mjs";

const authority = {
  approvalIssuer: "sangfor.production-approval",
  nonceConsumeUrl: "https://nonce.example.invalid/v1/production-nonces/consume",
  nonceConsumeBearerToken: "x".repeat(44),
};

/** Replays a scripted sequence of responses, recording what was sent. */
function scriptedFetch(responses) {
  const sent = [];
  const impl = async (url, init) => {
    sent.push({ url, init, body: JSON.parse(init.body) });
    const next = responses.shift();
    if (!next) throw new Error("scriptedFetch: no response left");
    return { status: next.status, json: async () => next.body };
  };
  impl.sent = sent;
  return impl;
}

function consumed(body) {
  return { status: 201, body: { schemaVersion: 1, consumed: true, nonce: body.nonce, receiptSha256: body.receiptSha256 } };
}

describe("runCanary", () => {
  it("passes when the authority consumes once and refuses the replay", async () => {
    let first = null;
    const impl = async (url, init) => {
      const body = JSON.parse(init.body);
      if (first === null) {
        first = body;
        return { status: 201, json: async () => consumed(body).body };
      }
      return { status: 409, json: async () => ({ schemaVersion: 1, consumed: false }) };
    };
    const result = await runCanary(authority, impl);
    assert.equal(result.ok, true);
    assert.equal(result.firstStatus, 201);
    assert.equal(result.replayStatus, 409);
    assert.match(result.nonce, /^canary-/u);
  });

  it("sends the same nonce twice — a replay of a different nonce would prove nothing", async () => {
    const bodies = [];
    const recording = async (url, init) => {
      const body = JSON.parse(init.body);
      bodies.push(body);
      return bodies.length === 1
        ? { status: 201, json: async () => consumed(body).body }
        : { status: 409, json: async () => ({ schemaVersion: 1, consumed: false }) };
    };
    await runCanary(authority, recording);
    assert.equal(bodies.length, 2);
    assert.deepEqual(bodies[0], bodies[1]);
  });

  it("submits a shape the authority accepts and that can never be a real deployment", async () => {
    const bodies = [];
    const recording = async (url, init) => {
      const body = JSON.parse(init.body);
      bodies.push({ url, body, auth: init.headers.authorization });
      return bodies.length === 1
        ? { status: 201, json: async () => consumed(body).body }
        : { status: 409, json: async () => ({ schemaVersion: 1, consumed: false }) };
    };
    await runCanary(authority, recording);
    const { url, body, auth } = bodies[0];
    assert.equal(url, authority.nonceConsumeUrl);
    assert.equal(auth, `Bearer ${authority.nonceConsumeBearerToken}`);
    assert.deepEqual(Object.keys(body).sort(), [
      "approvalId", "candidateSha", "issuer", "nonce", "receiptSha256", "runId", "schemaVersion",
    ]);
    assert.equal(body.issuer, authority.approvalIssuer);
    // All-zero SHA: no commit can ever hash to it, so this row is unmistakably a drill.
    assert.equal(body.candidateSha, "0".repeat(40));
    assert.match(body.nonce, /^canary-[A-Za-z0-9._-]+$/u);
    assert.ok(body.nonce.length >= 32 && body.nonce.length <= 128);
    assert.match(body.receiptSha256, /^[a-f0-9]{64}$/u);
  });

  it("fails when the first consume is not 201", async () => {
    const impl = scriptedFetch([{ status: 401, body: { error: "UNAUTHORIZED" } }]);
    await assert.rejects(runCanary(authority, impl), (error) => error instanceof CanaryError && error.exitCode === 70);
  });

  it("fails when the authority claims success without echoing the submission", async () => {
    // An authority that returns 201 without the right echo is not proving it
    // stored what we sent.
    const impl = scriptedFetch([{ status: 201, body: { schemaVersion: 1, consumed: true, nonce: "other", receiptSha256: "0".repeat(64) } }]);
    await assert.rejects(runCanary(authority, impl), (error) => error instanceof CanaryError && error.exitCode === 71);
  });

  it("fails when the replay is accepted instead of refused", async () => {
    let first = null;
    const impl = async (url, init) => {
      const body = JSON.parse(init.body);
      if (first === null) first = body;
      return { status: 201, json: async () => consumed(first).body };
    };
    await assert.rejects(runCanary(authority, impl), (error) => error instanceof CanaryError && error.exitCode === 72);
  });

  it("fails when the replay refuses but claims it consumed", async () => {
    let first = null;
    const impl = async (url, init) => {
      const body = JSON.parse(init.body);
      if (first === null) {
        first = body;
        return { status: 201, json: async () => consumed(body).body };
      }
      return { status: 409, json: async () => ({ schemaVersion: 1, consumed: true }) };
    };
    await assert.rejects(runCanary(authority, impl), (error) => error instanceof CanaryError && error.exitCode === 73);
  });
});

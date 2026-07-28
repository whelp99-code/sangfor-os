import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import {
  buildWebBaseUrl,
  buildWebSpawnArgv,
  isChildAlive,
  resolveFreshEvidenceDir,
  resolveWebPort,
  waitForOwnedWeb,
} from "./run-real-use-100.mjs";

const heldServers = [];

after(async () => {
  await Promise.all(heldServers.splice(0).map((server) => new Promise((resolve) => {
    server.close(() => resolve());
  })));
});

async function holdLoopbackPort() {
  const server = createServer();
  heldServers.push(server);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  assert.ok(port > 0);
  return port;
}

describe("run-real-use-100 web ownership (H1)", () => {
  it("uses an explicit free PORT after bind verification and never hard-codes 3101", async () => {
    const freePort = await resolveWebPort({});
    const port = await resolveWebPort({ PORT: String(freePort) });
    assert.equal(port, freePort);
    assert.equal(buildWebBaseUrl(port), `http://127.0.0.1:${port}`);
    const argv = buildWebSpawnArgv(port);
    assert.ok(argv.includes("-p"));
    assert.equal(argv[argv.indexOf("-p") + 1], String(port));
    assert.ok(!argv.includes("3101"));
  });

  it("prefers REAL_USE_WEB_PORT over PORT when both are free", async () => {
    const preferred = await resolveWebPort({});
    const other = await resolveWebPort({});
    const port = await resolveWebPort({
      REAL_USE_WEB_PORT: String(preferred),
      PORT: String(other),
    });
    assert.equal(port, preferred);
  });

  it("allocates a free ephemeral port when none is provided", async () => {
    const port = await resolveWebPort({});
    assert.ok(Number.isInteger(port) && port > 0 && port <= 65535);
    // Confirm the port is actually bindable (not merely a number).
    await new Promise((resolve, reject) => {
      const server = createServer();
      server.once("error", reject);
      server.listen(port, "127.0.0.1", () => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    });
  });

  it("rejects invalid explicit ports", async () => {
    await assert.rejects(() => resolveWebPort({ PORT: "0" }), /invalid web port/);
    await assert.rejects(() => resolveWebPort({ PORT: "abc" }), /invalid web port/);
  });

  it("rejects an explicit PORT that is already bound on 127.0.0.1", async () => {
    const occupied = await holdLoopbackPort();
    await assert.rejects(
      () => resolveWebPort({ PORT: String(occupied) }),
      /not bindable on 127\.0\.0\.1/,
    );
    await assert.rejects(
      () => resolveWebPort({ REAL_USE_WEB_PORT: String(occupied) }),
      /not bindable on 127\.0\.0\.1/,
    );
  });

  it("uses a run-scoped default evidence directory and rejects reuse", () => {
    const runId = "real-use-100-fresh-test";
    const fresh = resolveFreshEvidenceDir({}, runId);
    assert.ok(fresh.endsWith(`/.omo/evidence/${runId}`));

    const existing = mkdtempSync(join(tmpdir(), "real-use-existing-"));
    try {
      assert.throws(
        () => resolveFreshEvidenceDir({ REAL_USE_EVIDENCE_DIR: existing }, runId),
        /fresh REAL_USE_EVIDENCE_DIR required/,
      );
    } finally {
      rmSync(existing, { recursive: true, force: true });
    }
  });

  it("treats only running children as alive", () => {
    assert.equal(isChildAlive({ pid: 1, killed: false, exitCode: null, signalCode: null }), true);
    assert.equal(isChildAlive({ pid: 1, killed: true, exitCode: null, signalCode: null }), false);
    assert.equal(isChildAlive({ pid: 1, killed: false, exitCode: 1, signalCode: null }), false);
    assert.equal(isChildAlive({ pid: 1, killed: false, exitCode: null, signalCode: "SIGTERM" }), false);
    assert.equal(isChildAlive(null), false);
  });

  it("fails readiness when another host answers but the owned child is dead", async () => {
    const child = { pid: 99, killed: false, exitCode: 1, signalCode: null };
    let fetches = 0;
    await assert.rejects(
      () => waitForOwnedWeb({
        baseUrl: "http://127.0.0.1:39999",
        child,
        maxAttempts: 3,
        intervalMs: 1,
        sleepImpl: async () => undefined,
        fetchImpl: async () => {
          fetches += 1;
          return { status: 200 };
        },
      }),
      /web child exited/,
    );
    assert.equal(fetches, 0, "must not accept a foreign /login when child is already dead");
  });

  it("fails if the child dies after a successful HTTP probe", async () => {
    const child = { pid: 42, killed: false, exitCode: null, signalCode: null };
    await assert.rejects(
      () => waitForOwnedWeb({
        baseUrl: "http://127.0.0.1:39998",
        child,
        maxAttempts: 2,
        intervalMs: 1,
        sleepImpl: async () => undefined,
        fetchImpl: async () => {
          child.exitCode = 0;
          return { status: 200 };
        },
      }),
      /web child exited while probing readiness/,
    );
  });

  it("resolves only when the owned child is alive and HTTP is ready", async () => {
    const child = { pid: 7, killed: false, exitCode: null, signalCode: null };
    let hits = 0;
    await waitForOwnedWeb({
      baseUrl: "http://127.0.0.1:39997",
      child,
      maxAttempts: 5,
      intervalMs: 1,
      sleepImpl: async () => undefined,
      fetchImpl: async (url) => {
        hits += 1;
        assert.equal(url, "http://127.0.0.1:39997/login");
        return { status: 200 };
      },
    });
    assert.equal(hits, 1);
  });
});

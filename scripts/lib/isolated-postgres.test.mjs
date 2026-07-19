import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import {
  withIsolatedPostgres,
  assertSafeLocalDocker,
  loadAndMatchImageLock,
  cleanupIsolatedPostgres,
  DEFAULT_LOCK,
} from "./isolated-postgres.mjs";

const LOCK = JSON.parse(readFileSync(DEFAULT_LOCK, "utf8"));
const DIGEST = LOCK.manifestListDigest;

describe("isolated-postgres", () => {
  it("rejects non-boolean migrate / unknown options before container", async () => {
    await assert.rejects(
      () =>
        withIsolatedPostgres(
          {
            runId: "r",
            ownerUnit: "U007",
            purpose: "t",
            evidenceDir: mkdtempSync(join(tmpdir(), "pg-")),
            imageDigest: DIGEST,
            migrate: "true",
          },
          async () => {},
        ),
      /migrate must be boolean/,
    );
    await assert.rejects(
      () =>
        withIsolatedPostgres(
          {
            runId: "r",
            ownerUnit: "U007",
            purpose: "t",
            evidenceDir: mkdtempSync(join(tmpdir(), "pg-")),
            imageDigest: DIGEST,
            foo: 1,
          },
          async () => {},
        ),
      /unknown option/,
    );
  });

  it("lock fields exact", () => {
    const lock = loadAndMatchImageLock({
      imageDigest: DIGEST,
      lockPath: DEFAULT_LOCK,
    });
    assert.equal(lock.repository, "docker.io/library/postgres");
    assert.equal(lock.sourceTag, "16-alpine");
    assert.equal(lock.major, 16);
    assert.equal(lock.manifestListDigest, DIGEST);
  });

  it("assertSafeLocalDocker rejects DOCKER_HOST", async () => {
    const prev = process.env.DOCKER_HOST;
    process.env.DOCKER_HOST = "tcp://1.2.3.4:2375";
    try {
      await assert.rejects(() => assertSafeLocalDocker({}), /DOCKER_HOST/);
    } finally {
      if (prev === undefined) delete process.env.DOCKER_HOST;
      else process.env.DOCKER_HOST = prev;
    }
  });

  it(
    "withIsolatedPostgres spins real PG16, sentinel, cleanup 0 (migrate:false)",
    { timeout: 180_000 },
    async () => {
      // Clear ambient DATABASE_URL for this test
      const prevDb = process.env.DATABASE_URL;
      const prevDh = process.env.DOCKER_HOST;
      const prevDc = process.env.DOCKER_CONTEXT;
      delete process.env.DATABASE_URL;
      delete process.env.DOCKER_HOST;
      delete process.env.DOCKER_CONTEXT;

      const evidenceDir = mkdtempSync(join(tmpdir(), "u007-pg-"));
      const runId = `u007t${Date.now()}`;
      try {
        let sawUrl = false;
        await withIsolatedPostgres(
          {
            runId,
            ownerUnit: "U007",
            purpose: "unit-test",
            evidenceDir,
            imageDigest: DIGEST,
            migrate: false,
          },
          async (ctx) => {
            sawUrl = true;
            assert.match(ctx.databaseUrl, /^postgresql:\/\//);
            assert.equal(ctx.host, "127.0.0.1");
            assert.ok(ctx.port > 0);
            assert.match(ctx.databaseName, /^sangfor_task_/);
            assert.equal(ctx.sentinel.schemaVersion, 1);
            assert.equal(ctx.sentinel.imageDigest, DIGEST);
            assert.ok(existsSync(ctx.receiptPath));
            const receipt = JSON.parse(readFileSync(ctx.receiptPath, "utf8"));
            assert.equal(receipt.major, 16);
            assert.equal(receipt.host, "127.0.0.1");
            assert.equal(receipt.imageDigest, DIGEST);
          },
        );
        assert.equal(sawUrl, true);
        const cleanup = JSON.parse(
          readFileSync(join(evidenceDir, "postgres-cleanup.json"), "utf8"),
        );
        assert.equal(cleanup.status, "PASS");
        assert.equal(cleanup.remainingLabelCount, 0);
      } finally {
        if (prevDb !== undefined) process.env.DATABASE_URL = prevDb;
        if (prevDh !== undefined) process.env.DOCKER_HOST = prevDh;
        if (prevDc !== undefined) process.env.DOCKER_CONTEXT = prevDc;
        rmSync(evidenceDir, { recursive: true, force: true });
      }
    },
  );
});

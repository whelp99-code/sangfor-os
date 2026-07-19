import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, "run-with-isolated-postgres.mjs");
const LOCK = JSON.parse(
  readFileSync(
    join(HERE, "fixtures/restore-drill/postgres16-image.lock.json"),
    "utf8",
  ),
);

describe("run-with-isolated-postgres", () => {
  it("exit 64 when missing args or empty child argv", () => {
    const r = spawnSync(process.execPath, [SCRIPT], { encoding: "utf8" });
    assert.equal(r.status, 64);
    const r2 = spawnSync(
      process.execPath,
      [
        SCRIPT,
        "--run-id",
        "x",
        "--owner-unit",
        "U007",
        "--purpose",
        "p",
        "--image-digest",
        LOCK.manifestListDigest,
        "--evidence-dir",
        "/tmp",
        "--",
      ],
      { encoding: "utf8" },
    );
    assert.equal(r2.status, 64);
  });

  it("exit 64 on shell -c", () => {
    const r = spawnSync(
      process.execPath,
      [
        SCRIPT,
        "--run-id",
        "x",
        "--owner-unit",
        "U007",
        "--purpose",
        "p",
        "--image-digest",
        LOCK.manifestListDigest,
        "--evidence-dir",
        "/tmp",
        "--",
        "bash",
        "-c",
        "echo hi",
      ],
      { encoding: "utf8" },
    );
    assert.equal(r.status, 64);
  });

  it(
    "runs child with TASK_OWNED_DATABASE_URL and cleans up",
    { timeout: 180_000 },
    () => {
      const prev = process.env.DATABASE_URL;
      delete process.env.DATABASE_URL;
      delete process.env.DOCKER_HOST;
      delete process.env.DOCKER_CONTEXT;
      const evidenceDir = mkdtempSync(join(tmpdir(), "u007-rwip-"));
      try {
        const r = spawnSync(
          process.execPath,
          [
            SCRIPT,
            "--run-id",
            `cli${Date.now()}`,
            "--owner-unit",
            "U007",
            "--purpose",
            "cli-test",
            "--image-digest",
            LOCK.manifestListDigest,
            "--evidence-dir",
            evidenceDir,
            "--",
            process.execPath,
            "-e",
            "if(!process.env.TASK_OWNED_DATABASE_URL||!process.env.TASK_POSTGRES_RECEIPT_FILE)process.exit(2); process.exit(0)",
          ],
          { encoding: "utf8", env: { ...process.env } },
        );
        assert.equal(r.status, 0, r.stderr + r.stdout);
        const cleanup = JSON.parse(
          readFileSync(join(evidenceDir, "postgres-cleanup.json"), "utf8"),
        );
        assert.equal(cleanup.status, "PASS");
      } finally {
        if (prev !== undefined) process.env.DATABASE_URL = prev;
        rmSync(evidenceDir, { recursive: true, force: true });
      }
    },
  );
});

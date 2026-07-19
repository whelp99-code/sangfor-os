import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, chmodSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, "run-detached-release-mirror.mjs");
const HEAD = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim();

function writeLease(dir, overrides = {}) {
  const body = {
    runId: "run-selftest",
    ownerUnit: "U007",
    webPort: 15101,
    apiPort: 15200,
    issuedAt: new Date(Date.now() - 60_000).toISOString(),
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    ...overrides,
  };
  const p = join(dir, "lease.json");
  writeFileSync(p, JSON.stringify(body));
  chmodSync(p, 0o600);
  chmodSync(dir, 0o700);
  return p;
}

describe("run-detached-release-mirror", () => {
  it("exit 64 on missing required args / bad mode", () => {
    const r = spawnSync(process.execPath, [SCRIPT], { encoding: "utf8" });
    assert.equal(r.status, 64);
    const r2 = spawnSync(
      process.execPath,
      [SCRIPT, "--mode", "nope", "--candidate-sha", HEAD, "--run-id", "r", "--owner-unit", "U007", "--attempt-dir", "/tmp/x", "--resource-lease-file", "/tmp/y"],
      { encoding: "utf8" },
    );
    assert.equal(r2.status, 64);
  });

  it(
    "u007-release self-test against HEAD: exit 78 + dual receipts (machinery)",
    { timeout: 120_000 },
    () => {
      const dir = mkdtempSync(join(tmpdir(), "u007-outer-"));
      chmodSync(dir, 0o700);
      const lease = writeLease(dir);
      const attempt = join(dir, "attempt");
      try {
        const r = spawnSync(
          process.execPath,
          [
            SCRIPT,
            "--mode",
            "u007-release",
            "--candidate-sha",
            HEAD,
            "--run-id",
            "run-selftest",
            "--owner-unit",
            "U007",
            "--attempt-dir",
            attempt,
            "--resource-lease-file",
            lease,
          ],
          { encoding: "utf8", env: { ...process.env } },
        );
        assert.equal(r.status, 78, r.stderr + r.stdout);
        assert.ok(existsSync(join(attempt, "runner-contract-receipt.json")));
        assert.ok(existsSync(join(attempt, "product-release-receipt.json")));
        assert.ok(existsSync(join(attempt, "runner-contract-receipt.sha256")));
        assert.ok(existsSync(join(attempt, "product-release-receipt.sha256")));
        const product = JSON.parse(
          readFileSync(join(attempt, "product-release-receipt.json"), "utf8"),
        );
        assert.equal(product.product_release_status, "RED_EXPECTED");
        assert.equal(product.outerExitCode, 78);
        assert.equal(product.preflightBlockers.length, 1);
        assert.equal(product.preflightBlockers[0].package, "@sangfor/ui");
        assert.equal(product.cleanupStatus, "PASS");
        assert.equal(existsSync(join(attempt, "source")), false);
      } finally {
        spawnSync("git", ["worktree", "prune", "--expire", "now"]);
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );
});

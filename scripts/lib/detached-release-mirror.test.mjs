import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import {
  withDetachedReleaseMirror,
  assertCandidateCommit,
  collectIgnoredEnvInventory,
} from "./detached-release-mirror.mjs";

const HEAD = spawnSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).stdout.trim();

describe("detached-release-mirror", () => {
  it("rejects non-40hex / non-commit", async () => {
    await assert.rejects(() => assertCandidateCommit("deadbeef"), /40-hex/);
    await assert.rejects(
      () => assertCandidateCommit("0".repeat(40)),
      /not a commit/,
    );
  });

  it(
    "creates detached worktree at HEAD stand-in, env gate, cleanup, ignored-env equality",
    { timeout: 120_000 },
    async () => {
      const attemptDir = mkdtempSync(join(tmpdir(), "u007-mirror-"));
      try {
        const before = await collectIgnoredEnvInventory();
        const { receipt } = await withDetachedReleaseMirror(
          {
            candidateSha: HEAD,
            runId: `mirror-${Date.now()}`,
            ownerUnit: "U007",
            attemptDir,
            mode: "u007-release",
          },
          async ({ mirrorRoot, candidateSha, spawnInMirror, makeChildEnv }) => {
            assert.equal(candidateSha, HEAD);
            assert.ok(existsSync(join(mirrorRoot, "package.json")));
            const env = makeChildEnv("generic");
            assert.equal(env.DATABASE_URL, undefined);
            assert.equal(env.HTTP_PROXY, undefined);
            // Hostile parent must not appear
            const r = await spawnInMirror(
              [
                process.execPath,
                "-e",
                "const keys=Object.keys(process.env); if(keys.includes('DATABASE_URL')||keys.includes('HTTP_PROXY')||keys.includes('NODE_OPTIONS')) process.exit(2); process.exit(0)",
              ],
              {
                ...env,
                // deliberately do not pass hostile keys
              },
            );
            assert.equal(r.code, 0, r.stderr);
            return { ok: true };
          },
        );
        assert.equal(receipt.detached, true);
        assert.equal(receipt.mirrorHead, HEAD);
        assert.equal(receipt.cleanup.status, "PASS");
        assert.deepEqual(
          receipt.originalIgnoredEnvBefore,
          receipt.originalIgnoredEnvAfter,
        );
        assert.equal(existsSync(join(attemptDir, "source")), false);
        assert.ok(
          existsSync(join(attemptDir, "detached-release-mirror-receipt.json")),
        );
        // after still equals before
        const after = await collectIgnoredEnvInventory();
        assert.deepEqual(before, after);
      } finally {
        // ensure no leftover worktree
        spawnSync("git", ["worktree", "prune", "--expire", "now"], {
          encoding: "utf8",
        });
        rmSync(attemptDir, { recursive: true, force: true });
      }
    },
  );

  it("rejects existing mirror path", async () => {
    const attemptDir = mkdtempSync(join(tmpdir(), "u007-mirror-exist-"));
    mkdirSync(join(attemptDir, "source"));
    try {
      await assert.rejects(
        () =>
          withDetachedReleaseMirror(
            {
              candidateSha: HEAD,
              runId: "r",
              ownerUnit: "U007",
              attemptDir,
            },
            async () => {},
          ),
        /must be absent/,
      );
    } finally {
      rmSync(attemptDir, { recursive: true, force: true });
    }
  });
});

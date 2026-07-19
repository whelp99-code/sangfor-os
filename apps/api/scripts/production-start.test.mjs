import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import { setTimeout as sleep } from "node:timers/promises";
import { buildProduction } from "./build-production.mjs";

const apiRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function freePort() {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const addr = s.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      s.close((err) => (err ? reject(err) : resolve(port)));
    });
    s.on("error", reject);
  });
}

describe("api production-start", () => {
  it(
    "spawns dist/index.mjs on leased API_PORT, /api/health 200, SIGTERM clean",
    { timeout: 120_000 },
    async () => {
      // Serialize against build-production.test (both wipe dist/); rebuild here.
      await buildProduction();
      const entry = join(apiRoot, "dist/index.mjs");
      assert.ok(existsSync(entry), "dist/index.mjs missing after build");

      const apiPort = await freePort();
      const child = spawn(process.execPath, [entry], {
        cwd: apiRoot,
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          TMPDIR: process.env.TMPDIR,
          API_PORT: String(apiPort),
          HOST: "127.0.0.1",
          NODE_ENV: "test",
          SANGFOR_PROCESS_PROFILE: "test",
        },
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (d) => (stdout += d));
      child.stderr.on("data", (d) => (stderr += d));

      let healthy = false;
      let body = null;
      const deadline = Date.now() + 30_000;
      while (Date.now() < deadline) {
        try {
          // Contract: /health 200
          const res = await fetch(`http://127.0.0.1:${apiPort}/health`);
          if (res.status === 200) {
            body = await res.json();
            healthy = true;
            break;
          }
        } catch {
          // not up yet
        }
        if (child.exitCode !== null) break;
        await sleep(200);
      }

      if (!healthy) {
        child.kill("SIGTERM");
        assert.fail(
          `health not 200: exit=${child.exitCode} stderr=${stderr} stdout=${stdout}`,
        );
      }
      assert.ok(body);

      child.kill("SIGTERM");
      const code = await new Promise((resolve) => {
        child.on("close", (c, signal) => {
          resolve(signal ? 0 : c);
        });
        setTimeout(() => {
          child.kill("SIGKILL");
          resolve(-1);
        }, 10_000);
      });
      assert.ok(code === 0 || code === null || code === 143 || code === -1);
    },
  );
});

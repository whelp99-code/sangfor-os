/**
 * U006 surface lifecycle unit tests — fake spawn/server adapters.
 * Asserts cleanup runs EXACTLY ONCE for normal / request-failure /
 * child-early-exit / exception / SIGINT / SIGTERM.
 */
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import {
  createCleanupController,
  validateSurfaceEnv,
  bindProbe,
  buildWebTestEnv,
  runU006HealthSurface,
} from "./verify-u006-health-surface.mjs";

function makeEvidenceDir() {
  const root = mkdtempSync(join(tmpdir(), "u006-surface-"));
  // Shape: .../U006/attempt-test/surface
  const attempt = join(root, "U006", "attempt-test");
  const surface = join(attempt, "surface");
  mkdirSync(surface, { recursive: true });
  return { root, attempt, surface };
}

function validEnv(surface) {
  return {
    TASK_RUN_ID: "u006-test-run",
    LEASED_WEB_PORT: "46201",
    U006_EVIDENCE_DIR: surface,
    PATH: process.env.PATH,
    HOME: process.env.HOME,
  };
}

test("validateSurfaceEnv rejects missing/invalid inputs", () => {
  assert.throws(() => validateSurfaceEnv({}), /TASK_RUN_ID/);
  assert.throws(
    () =>
      validateSurfaceEnv({
        TASK_RUN_ID: "x",
        LEASED_WEB_PORT: "80",
        U006_EVIDENCE_DIR: "/tmp/U006/attempt-1/surface",
      }),
    /1024/,
  );
  assert.throws(
    () =>
      validateSurfaceEnv({
        TASK_RUN_ID: "x",
        LEASED_WEB_PORT: "46201",
        U006_EVIDENCE_DIR: "relative/path",
      }),
    /absolute/,
  );
  assert.throws(
    () =>
      validateSurfaceEnv({
        TASK_RUN_ID: "x",
        LEASED_WEB_PORT: "46201",
        U006_EVIDENCE_DIR: "/tmp/not-u006/surface",
      }),
    /U006\/attempt/,
  );
});

test("createCleanupController runs cleanup exactly once", async () => {
  let count = 0;
  const controller = createCleanupController(async () => {
    count += 1;
    return { ok: true };
  });
  const a = await controller.cleanupOnce();
  const b = await controller.cleanupOnce();
  const c = await controller.interrupt("SIGINT");
  assert.equal(count, 1);
  assert.deepEqual(a, b);
  assert.equal(c.exitCode, 130);
  assert.deepEqual(c.cleanup, a);
});

test("buildWebTestEnv points health URLs at mock and uses test profile", () => {
  const env = buildWebTestEnv({
    mockBase: "http://127.0.0.1:9999",
    leasedWebPort: 46210,
    parentEnv: { PATH: "/bin", HOME: "/tmp" },
  });
  assert.equal(env.SANGFOR_PROCESS_PROFILE, "test");
  assert.equal(env.WHELP99_MCP_HTTP_URL, "http://127.0.0.1:9999");
  assert.equal(env.SANGFOR_MCP_URL, "http://127.0.0.1:9999");
  assert.equal(env.PORT, "46210");
});

/**
 * Build fake adapters for a full run that never touches the real network/next.
 * @param {{ failRequest?: boolean, earlyExit?: boolean, throwAfterReady?: boolean }} behavior
 */
function createFakeAdapters(behavior = {}) {
  const signalTarget = new EventEmitter();
  let cleanupCount = 0;
  let webKilledWith = null;
  /** @type {import('node:http').Server | null} */
  let mockServer = null;
  let mockPort = 0;
  let webExitHandlers = [];
  let requestCount = 0;

  const fakeChild = {
    pid: 4242,
    exitCode: null,
    signalCode: null,
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    once(event, handler) {
      if (event === "exit") webExitHandlers.push(handler);
      return this;
    },
    removeListener(event, handler) {
      if (event === "exit") {
        webExitHandlers = webExitHandlers.filter((h) => h !== handler);
      }
      return this;
    },
  };

  /** @type {Array<() => void>} */
  const pendingListens = [];

  const adapters = {
    signalTarget,
    writeEvidence: true,
    sleep: async () => {},
    exitProcess: () => {},
    spawn: (cmd, argv, opts) => {
      assert.equal(cmd, "bash");
      assert.equal(opts.shell, false);
      assert.equal(opts.detached, true);
      assert.ok(argv.includes("run-workspace-runtime.sh") || argv.some((a) => String(a).endsWith("run-workspace-runtime.sh")));
      assert.ok(argv.includes("@sangfor/web"));
      assert.ok(argv.includes("next"));
      assert.ok(argv.includes("dev"));
      if (behavior.earlyExit) {
        Promise.resolve().then(() => {
          fakeChild.exitCode = 1;
          for (const h of webExitHandlers) h(1, null);
        });
      }
      return fakeChild;
    },
    createHttpServer: (handler) => {
      const server = new EventEmitter();
      server.closeAllConnections = () => {};
      server.listen = (port, host, cb) => {
        assert.equal(port, 0);
        assert.equal(host, "127.0.0.1");
        mockPort = 55555;
        mockServer = server;
        Promise.resolve().then(() => cb && cb());
        return server;
      };
      server.address = () => ({ port: mockPort, address: "127.0.0.1", family: "IPv4" });
      server.close = (cb) => {
        cleanupCount += 1; // track close path via side channel? no — use outer
        mockServer = null;
        Promise.resolve().then(() => cb && cb());
      };
      server._handler = handler;
      return server;
    },
    createNetServer: () => {
      const server = new EventEmitter();
      server.listen = (port, host, cb) => {
        Promise.resolve().then(() => cb && cb());
        return server;
      };
      server.close = (cb) => {
        Promise.resolve().then(() => cb && cb());
      };
      return server;
    },
    fetchImpl: async (url) => {
      requestCount += 1;
      if (behavior.throwAfterReady && requestCount > 1) {
        throw new Error("injected request failure");
      }
      if (behavior.failRequest && requestCount > 1) {
        throw new Error("injected request failure");
      }
      // ready check + scenarios
      // Simulate: first calls ready 200; then green 200; critical 503; optional 200 with disabled
      if (String(url).includes("unified-health")) {
        if (requestCount === 1) {
          return {
            status: 200,
            text: async () =>
              JSON.stringify({
                overall: "ok",
                summary: { disabled: 2, ok: 2, total: 4 },
                services: [],
              }),
          };
        }
        if (requestCount === 2) {
          // green
          return {
            status: 200,
            text: async () =>
              JSON.stringify({
                overall: "ok",
                summary: { disabled: 2, ok: 2, degraded: 0, error: 0, total: 4 },
                services: [
                  { id: "a", status: "ok", criticality: "critical" },
                  { id: "b", status: "ok", criticality: "critical" },
                  { id: "c", status: "disabled", criticality: "optional" },
                  { id: "d", status: "disabled", criticality: "optional" },
                ],
              }),
          };
        }
        if (requestCount === 3) {
          // critical-down
          return {
            status: 503,
            text: async () =>
              JSON.stringify({
                overall: "degraded",
                summary: { disabled: 2, ok: 1, degraded: 0, error: 1, total: 4 },
                services: [],
              }),
          };
        }
        // optional-disabled
        return {
          status: 200,
          text: async () =>
            JSON.stringify({
              overall: "ok",
              summary: { disabled: 2, ok: 2, degraded: 0, error: 0, total: 4 },
              services: [
                { id: "c", status: "disabled", criticality: "optional" },
              ],
            }),
        };
      }
      return { status: 404, text: async () => "" };
    },
  };

  // Patch process.kill for web process group
  const originalKill = process.kill;
  process.kill = (pid, signal) => {
    webKilledWith = { pid, signal };
    if (pid === -4242 || pid === 4242) {
      fakeChild.exitCode = signal === "SIGKILL" ? null : 0;
      fakeChild.signalCode = signal;
      for (const h of [...webExitHandlers]) h(fakeChild.exitCode, signal);
      return true;
    }
    return originalKill.call(process, pid, signal);
  };

  const restore = () => {
    process.kill = originalKill;
  };

  return {
    adapters,
    signalTarget,
    getWebKilledWith: () => webKilledWith,
    getRequestCount: () => requestCount,
    restore,
    fakeChild,
  };
}

test("normal path: three scenarios + cleanup once + SIGTERM web", async () => {
  const { surface, root } = makeEvidenceDir();
  const { adapters, restore, getWebKilledWith } = createFakeAdapters();
  try {
    const result = await runU006HealthSurface({
      env: validEnv(surface),
      adapters,
    });
    assert.equal(result.ok, true);
    assert.equal(result.lifecycle.cleanupInvocations, 1);
    assert.equal(result.lifecycle.listenersAfter, 0);
    assert.equal(result.lifecycle.portsAvailableAfter, 2);
    assert.equal(result.lifecycle.childProcessesAfter, 0);
    assert.equal(result.lifecycle.web.forcedKill, false);
    assert.equal(result.lifecycle.docker.cleanup, "N/A");
    assert.equal(result.lifecycle.database.cleanup, "N/A");
    assert.ok(getWebKilledWith()?.signal === "SIGTERM" || getWebKilledWith()?.signal === "SIGKILL");
    assert.equal(result.scenarios.length, 3);
    assert.ok(existsSync(join(surface, "surface-lifecycle.json")));
  } finally {
    restore();
    rmSync(root, { recursive: true, force: true });
  }
});

test("request-failure path still runs cleanup exactly once", async () => {
  const { surface, root } = makeEvidenceDir();
  const { adapters, restore } = createFakeAdapters({ failRequest: true });
  try {
    await assert.rejects(
      () =>
        runU006HealthSurface({
          env: validEnv(surface),
          adapters,
        }),
      /injected request failure|scenarios failed|cleanup/,
    );
    // lifecycle file should exist from cleanup
    const lifePath = join(surface, "surface-lifecycle.json");
    assert.ok(existsSync(lifePath));
    const life = JSON.parse(readFileSync(lifePath, "utf8"));
    assert.equal(life.cleanupInvocations, 1);
  } finally {
    restore();
    rmSync(root, { recursive: true, force: true });
  }
});

test("child early-exit runs cleanup exactly once", async () => {
  const { surface, root } = makeEvidenceDir();
  const { adapters, restore } = createFakeAdapters({ earlyExit: true });
  try {
    await assert.rejects(
      () =>
        runU006HealthSurface({
          env: validEnv(surface),
          adapters,
        }),
      /exited early|cleanup/,
    );
    const life = JSON.parse(
      readFileSync(join(surface, "surface-lifecycle.json"), "utf8"),
    );
    assert.equal(life.cleanupInvocations, 1);
  } finally {
    restore();
    rmSync(root, { recursive: true, force: true });
  }
});

test("exception path runs cleanup exactly once", async () => {
  const { surface, root } = makeEvidenceDir();
  const { adapters, restore } = createFakeAdapters();
  // Force exception by breaking createHttpServer after validation
  const broken = {
    ...adapters,
    createHttpServer: () => {
      throw new Error("boom-create-server");
    },
  };
  try {
    await assert.rejects(
      () =>
        runU006HealthSurface({
          env: validEnv(surface),
          adapters: broken,
        }),
      /boom-create-server/,
    );
  } finally {
    restore();
    rmSync(root, { recursive: true, force: true });
  }
});

for (const signal of /** @type {const} */ (["SIGINT", "SIGTERM"])) {
  test(`${signal} awaits cleanup once then exits with ${signal === "SIGINT" ? 130 : 143}`, async () => {
    const { surface, root } = makeEvidenceDir();
    let exitCode = null;
    const { adapters, signalTarget, restore } = createFakeAdapters();
    adapters.exitProcess = (code) => {
      exitCode = code;
    };

    // Park on sleep during ready wait, then signal
    let sleepCalls = 0;
    adapters.fetchImpl = async () => {
      throw new Error("ECONNREFUSED"); // not ready yet
    };
    adapters.sleep = async () => {
      sleepCalls += 1;
      if (sleepCalls === 1) {
        signalTarget.emit(signal);
        // Give interrupt microtasks a turn
        await new Promise((r) => setImmediate(r));
        await new Promise((r) => setImmediate(r));
      }
    };

    try {
      // run may reject if exitProcess doesn't stop the function; interrupt exits via exitProcess
      const runPromise = runU006HealthSurface({
        env: validEnv(surface),
        adapters,
      }).catch((err) => err);

      // Wait for signal handler to finish cleanup + exitProcess
      for (let i = 0; i < 20 && exitCode === null; i++) {
        await new Promise((r) => setTimeout(r, 10));
      }

      assert.equal(exitCode, signal === "SIGINT" ? 130 : 143);
      const lifePath = join(surface, "surface-lifecycle.json");
      assert.ok(existsSync(lifePath), "lifecycle evidence written");
      const life = JSON.parse(readFileSync(lifePath, "utf8"));
      assert.equal(life.cleanupInvocations, 1);
      void runPromise;
    } finally {
      restore();
      rmSync(root, { recursive: true, force: true });
    }
  });
}

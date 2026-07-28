import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import express, { type Express } from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

type HttpResult = {
  readonly status: number;
  readonly body: string;
};

const authenticatedBodySchema = z.object({
  principalId: z.string(),
  businessRole: z.string(),
});

const testDirectory = dirname(fileURLToPath(import.meta.url));
const apiDirectory = resolve(testDirectory, "../..");
const tsxBinary = resolve(apiDirectory, "node_modules/.bin/tsx");
const apiEntrypoint = resolve(apiDirectory, "src/index.ts");

async function requestApp(app: Express, apiKey?: string): Promise<HttpResult> {
  const server = createServer(app);
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    server.close();
    throw new Error("Expected an ephemeral TCP listener");
  }

  try {
    const headers = apiKey === undefined ? undefined : { "x-api-key": apiKey };
    const response = await fetch(`http://127.0.0.1:${address.port}/probe`, { headers });
    return { status: response.status, body: await response.text() };
  } finally {
    await new Promise<void>((resolveClose, reject) => {
      server.close((error) => (error ? reject(error) : resolveClose()));
    });
  }
}

async function importMiddleware(): Promise<typeof import("./api-key")> {
  vi.resetModules();
  return import("./api-key");
}

async function reserveLoopbackPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    server.close();
    throw new Error("Expected an ephemeral TCP listener");
  }
  await new Promise<void>((resolveClose, reject) => {
    server.close((error) => (error ? reject(error) : resolveClose()));
  });
  return address.port;
}

function createProbeApp(middleware: typeof import("./api-key").apiKeyMiddleware): Express {
  const app = express();
  app.use(middleware);
  app.get("/probe", (request, response) => {
    response.json({
      principalId: request.authContext?.userId,
      businessRole: request.authContext?.businessRole,
    });
  });
  return app;
}

describe("apiKeyMiddleware containment", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("returns 401 when a bypass flag lacks the explicit local_mock profile", async () => {
    // Given: a development process has the legacy bypass flag but no profile.
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("AUTH_BYPASS_ENABLED", "1");
    vi.stubEnv("AUTH_PROFILE", "");
    const { apiKeyMiddleware } = await importMiddleware();

    // When: a request supplies no API key.
    const result = await requestApp(createProbeApp(apiKeyMiddleware));

    // Then: the request remains unauthenticated.
    expect(result.status).toBe(401);
  });

  it("returns 401 for an invalid API key", async () => {
    // Given: the server registers a finance key.
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("FINANCE_API_KEY", "u002-valid-finance-key-00000000");
    const { apiKeyMiddleware } = await importMiddleware();

    // When: a different credential is presented.
    const result = await requestApp(createProbeApp(apiKeyMiddleware), "u002-invalid-key-0000000000000");

    // Then: invalid credentials use the unauthenticated response.
    expect(result.status).toBe(401);
  });

  it("derives the operator principal from the registered server key", async () => {
    // Given: the server registers its operator API key.
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("API_KEY", "u002-valid-operator-key-000000000");
    const { apiKeyMiddleware } = await importMiddleware();

    // When: the registered credential is presented without identity headers.
    const result = await requestApp(
      createProbeApp(apiKeyMiddleware),
      "u002-valid-operator-key-000000000",
    );

    // Then: identity and role come from the server-side key registry.
    expect(result.status).toBe(200);
    expect(authenticatedBodySchema.parse(JSON.parse(result.body))).toEqual({
      principalId: "apikey:default",
      businessRole: "system_admin",
    });
  });

  it.each([
    ["bypass enabled", { AUTH_BYPASS_ENABLED: "1" }],
    ["local mock profile", { AUTH_PROFILE: "local_mock" }],
    ["missing API key", { API_KEY: " " }],
    ["missing finance key", { FINANCE_API_KEY: " " }],
    ["missing MCP bridge key", { SANGFOR_API_KEY: " " }],
    ["missing operator principal", { SANGFOR_OPERATOR_PRINCIPAL_ID: " " }],
    ["normalized API and finance keys are equal", { API_KEY: "  u002-equal-production-key-000000  ", FINANCE_API_KEY: "u002-equal-production-key-000000" }],
  ])("exits 78 before listener registration when production has %s", (_label, override) => {
    // Given: an otherwise valid production API process has one unsafe auth setting.
    const childDirectory = mkdtempSync(resolve(tmpdir(), "u002-api-preflight-"));
    const env = {
      ...process.env,
      NODE_ENV: "production",
      AUTH_BYPASS_ENABLED: "0",
      AUTH_PROFILE: "strict",
      API_KEY: "u002-valid-operator-key-000000000",
      FINANCE_API_KEY: "u002-valid-finance-key-00000000",
      SANGFOR_API_KEY: "u002-valid-mcp-bridge-key",
      SANGFOR_OPERATOR_PRINCIPAL_ID: "u002-server-operator",
      API_PORT: "0",
      ...override,
    };

    try {
      // When: the real API entrypoint is launched.
      const result = spawnSync(tsxBinary, [apiEntrypoint], {
        cwd: childDirectory,
        env,
        encoding: "utf8",
        timeout: 5_000,
      });

      // Then: preflight terminates before the listener can be registered.
      expect(result.status).toBe(78);
      expect(result.signal).toBeNull();
      expect(result.stderr.trim()).toBe("UNSAFE_AUTH_CONFIGURATION");
    } finally {
      rmSync(childDirectory, { recursive: true, force: true });
    }
  });

  it("binds a valid production API listener only to the configured loopback host", async () => {
    // Given: a valid production configuration and a dispatcher-style loopback port.
    const childDirectory = mkdtempSync(resolve(tmpdir(), "u002-api-listener-"));
    const port = await reserveLoopbackPort();
    const child = spawn(tsxBinary, [apiEntrypoint], {
      cwd: childDirectory,
      detached: true,
      env: {
        ...process.env,
        NODE_ENV: "production",
        HOST: "127.0.0.1",
        AUTH_BYPASS_ENABLED: "0",
        WHELP99_ENFORCE_SAFE_TOOLS: "true",
        API_KEY: "u002-valid-operator-key-000000000",
        FINANCE_API_KEY: "u002-valid-finance-key-00000000",
        SANGFOR_API_KEY: "u002-valid-mcp-bridge-key",
        SANGFOR_OPERATOR_PRINCIPAL_ID: "u002-server-operator",
        API_PORT: String(port),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    try {
      // When: the real entrypoint reports listener readiness.
      await new Promise<void>((resolveReady, reject) => {
        const timeout = setTimeout(() => reject(new Error(`API listener timeout: ${stderr}`)), 5_000);
        child.stdout.setEncoding("utf8");
        child.stdout.on("data", (chunk: string) => {
          if (chunk.includes("AIOS API Server running")) {
            clearTimeout(timeout);
            resolveReady();
          }
        });
        child.once("exit", (code, signal) => {
          clearTimeout(timeout);
          reject(new Error(`API exited before readiness: code=${code} signal=${signal} stderr=${stderr}`));
        });
      });
      const listener = spawnSync(
        "lsof",
        ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"],
        { encoding: "utf8" },
      );
      process.stdout.write(`U002_API_LISTENER=${JSON.stringify(listener.stdout.trim())}\n`);

      // Then: lsof observes one loopback listener and no wildcard bind.
      expect(listener.status).toBe(0);
      expect(listener.stdout).toContain(`127.0.0.1:${port} (LISTEN)`);
      expect(listener.stdout).not.toContain(`*:${port} (LISTEN)`);
    } finally {
      if (child.pid !== undefined && child.exitCode === null && child.signalCode === null) {
        try {
          process.kill(-child.pid, "SIGTERM");
        } catch (error) {
          expect((error as NodeJS.ErrnoException).code).toBe("ESRCH");
        }
      }
      await new Promise<void>((resolveExit) => {
        if (child.exitCode !== null || child.signalCode !== null) resolveExit();
        else child.once("exit", () => resolveExit());
      });
      rmSync(childDirectory, { recursive: true, force: true });
    }
  });
});

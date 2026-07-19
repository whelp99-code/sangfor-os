/**
 * AIOS API Server
 * Express API 서버
 */

import express, { type Express } from "express";
import cors from "cors";
import { fileURLToPath } from "node:url";
import {
  probeIntegrationTarget,
  probeAllIntegrationTargets,
  getIntegrationTarget,
  listMcpTools,
  callMcpTool,
} from "@sangfor/infra";
import {
  apiKeyMiddleware,
  authMiddleware,
  errorHandler,
  financeAccessGuard,
  rateLimiter,
  systemAdminAccessGuard,
} from "./middleware";
import { metrics } from "@sangfor/infra";
import { createEventRoutes, eventBus } from "./routes/events";
import { createCfoHealthRoutes, createCfoRoutes } from "./routes/cfo";
import { OutlookWebhookHandler } from "@sangfor/api-utils";
import {
  findCallerIdentityConflicts,
  stripCallerIdentityFields,
} from "@sangfor/auth";

const PORT = Number(process.env.API_PORT ?? 3200);
const HOST = process.env.HOST || "127.0.0.1";
const U002_IPC_PROTOCOL = "u002-containment-ipc/v1" as const;

type ApiIpcState = "idle" | "armed" | "captured" | "released" | "complete";
type ApiIpcMessage = {
  readonly protocol: typeof U002_IPC_PROTOCOL;
  readonly type: "arm" | "release";
  readonly boundary: "api-to-infra";
  readonly nonce: string;
};

let apiIpcState: ApiIpcState = "idle";
let apiIpcNonce = "";
let apiIpcRelease: (() => void) | undefined;
let apiIpcDisconnect: ((error: Error) => void) | undefined;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseApiIpcMessage(value: unknown): ApiIpcMessage | undefined {
  if (!isRecord(value)) return undefined;
  if (value.protocol !== U002_IPC_PROTOCOL) return undefined;
  if (value.type !== "arm" && value.type !== "release") return undefined;
  if (value.boundary !== "api-to-infra" || typeof value.nonce !== "string") return undefined;
  return {
    protocol: U002_IPC_PROTOCOL,
    type: value.type,
    boundary: "api-to-infra",
    nonce: value.nonce,
  };
}

function sendApiIpcMessage(message: Readonly<Record<string, unknown>>): Promise<void> {
  const send = process.send;
  if (typeof send !== "function" || process.connected !== true) return Promise.resolve();
  return new Promise<void>((resolveSend, rejectSend) => {
    send.call(process, message, (error: Error | null) => {
      if (error) rejectSend(error);
      else resolveSend();
    });
  });
}

function onApiIpcMessage(value: unknown): void {
  const message = parseApiIpcMessage(value);
  if (!message) return;
  if (message.type === "arm" && apiIpcState === "idle") {
    apiIpcNonce = message.nonce;
    apiIpcState = "armed";
    void sendApiIpcMessage({
      protocol: U002_IPC_PROTOCOL,
      type: "armed",
      boundary: "api-to-infra",
      nonce: apiIpcNonce,
    }).catch(() => {
      apiIpcState = "idle";
      apiIpcNonce = "";
    });
    return;
  }
  if (message.nonce !== apiIpcNonce) return;
  if (message.type === "release" && apiIpcState === "captured") {
    apiIpcState = "released";
    apiIpcRelease?.();
  }
}

function onApiIpcDisconnect(): void {
  if (apiIpcState !== "captured") return;
  apiIpcDisconnect?.(new Error("U002_IPC_DISCONNECTED"));
}

if (typeof process.send === "function" && process.connected === true) {
  process.on("message", onApiIpcMessage);
  process.on("disconnect", onApiIpcDisconnect);
}

async function awaitApiIpcRelease(
  toolName: string,
  argumentsValue: Readonly<Record<string, unknown>>,
): Promise<void> {
  if (apiIpcState !== "armed") return;
  apiIpcState = "captured";
  const releasePromise = new Promise<void>((resolveRelease, rejectRelease) => {
    apiIpcRelease = resolveRelease;
    apiIpcDisconnect = rejectRelease;
  });
  await sendApiIpcMessage({
    protocol: U002_IPC_PROTOCOL,
    type: "capture",
    boundary: "api-to-infra",
    nonce: apiIpcNonce,
    toolName,
    arguments: argumentsValue,
  });
  await releasePromise;
  apiIpcRelease = undefined;
  apiIpcDisconnect = undefined;
}

async function completeApiIpc(outcome: "returned" | "threw"): Promise<void> {
  if (apiIpcState !== "released") return;
  try {
    await sendApiIpcMessage({
      protocol: U002_IPC_PROTOCOL,
      type: "complete",
      boundary: "api-to-infra",
      nonce: apiIpcNonce,
      outcome,
    });
  } finally {
    apiIpcState = "complete";
    process.off("message", onApiIpcMessage);
    process.off("disconnect", onApiIpcDisconnect);
  }
}

function isUnknownRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function createApp(): Express {
  const app = express();

  // Middleware
  app.use(
    cors({
      origin: process.env.CORS_ORIGIN || "http://localhost:3110",
      credentials: true,
    }),
  );
  app.use(express.json({ limit: "10mb" }));
  app.use(rateLimiter({ windowMs: 60000, maxRequests: 200 }));

  // Metrics tracking
  app.use((req, res, next) => {
    metrics.incrementCounter("http_requests_total", { method: req.method, path: req.path });
    next();
  });

  app.use(
    "/api/cfo",
    apiKeyMiddleware,
    financeAccessGuard,
    createCfoHealthRoutes(),
    createCfoRoutes(),
  );

  app.get("/api/whelp99/tools", apiKeyMiddleware, systemAdminAccessGuard, async (_req, res) => {
    try {
      const tools = await listMcpTools();
      res.json({ tools });
    } catch (error) {
      console.error("[api] whelp99 tools list failed:", error instanceof Error ? error.stack ?? error.message : error);
      res.status(502).json({ error: "upstream_unavailable", tools: [] });
    }
  });

  app.post("/api/whelp99/tools/call", apiKeyMiddleware, systemAdminAccessGuard, async (req, res) => {
    const body: unknown = req.body;
    const name = isUnknownRecord(body) && typeof body.name === "string" ? body.name : "";
    if (!name) {
      res.status(400).json({ error: "name is required" });
      return;
    }
    const principalId = req.authContext?.userId;
    const rawArguments = isUnknownRecord(body) ? body.arguments ?? body.args ?? {} : {};
    if (!principalId || !isUnknownRecord(rawArguments)) {
      res.status(400).json({ error: "invalid arguments" });
      return;
    }
    if (findCallerIdentityConflicts(body, principalId).length > 0) {
      res.status(400).json({ error: "IDENTITY_CONFLICT" });
      return;
    }
    const sanitizedArguments = stripCallerIdentityFields(rawArguments);
    if (!isUnknownRecord(sanitizedArguments)) {
      res.status(400).json({ error: "invalid arguments" });
      return;
    }
    try {
      await awaitApiIpcRelease(name, sanitizedArguments);
      const result = await callMcpTool(name, sanitizedArguments);
      await completeApiIpc("returned");
      res.status(result.error ? 502 : 200).json(result);
    } catch (error) {
      await completeApiIpc("threw").catch(() => undefined);
      console.error("[api] whelp99 tool call failed:", error instanceof Error ? error.stack ?? error.message : error);
      res.status(500).json({ error: "upstream_unavailable" });
    }
  });

  app.use("/api", authMiddleware, systemAdminAccessGuard);

  // Prometheus metrics endpoint
  app.get("/api/metrics", (_req, res) => {
    metrics.setGauge("active_sse_connections", eventBus.getClientCount());
    res.type("text/plain").send(metrics.getMetrics());
  });

  app.get("/health", authMiddleware, systemAdminAccessGuard, (_req, res) => {
    res.json({
      status: "ok",
      version: "0.1.0",
      timestamp: new Date().toISOString(),
    });
  });

  // Also expose health under /api path for F-aios-v3 proxy compatibility
  app.get("/api/health", (_req, res) => {
    res.json({
      status: "ok",
      version: "0.1.0",
      timestamp: new Date().toISOString(),
    });
  });

  // whelp99 health bridge — HTTP probe against the MCP HTTP bridge (/health)
  app.get("/api/whelp99/health", async (_req, res) => {
    try {
      const target = getIntegrationTarget("whelp99-code-sangfor-engineer-mcp");
      const result = await probeIntegrationTarget(target);
      res.status(result.status === "healthy" ? 200 : 503).json({
        id: result.id,
        status: result.status,
        upstream: result.upstream,
        latencyMs: result.latencyMs,
        details: result.details ?? target.readinessNote,
      });
    } catch (error) {
      console.error("[api] whelp99 health probe failed:", error instanceof Error ? error.stack ?? error.message : error);
      res.status(500).json({
        id: "whelp99-code-sangfor-engineer-mcp",
        status: "unreachable",
        upstream: "",
        details: "upstream_unavailable",
      });
    }
  });

  // Aggregate health for every registered integration target (MCP services).
  app.get("/api/integrations/health", async (_req, res) => {
    try {
      const results = await probeAllIntegrationTargets();
      const allHealthy = results.every((r) => r.status === "healthy");
      res.status(allHealthy ? 200 : 503).json({
        status: allHealthy ? "ok" : "degraded",
        targets: results,
      });
    } catch (error) {
      console.error("[api] integrations health aggregate failed:", error instanceof Error ? error.stack ?? error.message : error);
      res.status(500).json({
        status: "error",
        details: "upstream_unavailable",
      });
    }
  });

  // Slack status — env-based detection
  app.get("/api/slack/status", (_req, res) => {
    const hasWebhook = Boolean(process.env.SLACK_WEBHOOK_URL);
    const hasBotToken = Boolean(process.env.SLACK_BOT_TOKEN);
    const connected = hasWebhook || hasBotToken;
    res.json({
      connected,
      hasWebhook,
      hasBotToken,
      status: connected ? "ok" : "unreachable",
    });
  });

  app.use("/api", createEventRoutes());

  // Webhook routes
  const outlookWebhook = new OutlookWebhookHandler(
    process.env.WEBHOOK_CLIENT_STATE || "aios-webhook",
    async (mail) => {
      try {
        const { HybridMailClassifier } = await import("@sangfor/persona");
        const classifier = new HybridMailClassifier();
        const result = await classifier.classifyAsync(mail, { mode: "rules-only" });
        console.log(`[Webhook] Classified mail ${mail.id}: ${result.result.category}`);
      } catch (err) {
        console.error(`[Webhook] Classification failed for ${mail.id}:`, err);
      }
    },
  );

  // GET /webhooks/outlook - validation endpoint (Azure AD requires this)
  app.get("/webhooks/outlook", (req, res) => {
    const validationToken = req.query.validationToken as string;
    if (validationToken) {
      res.type("text/plain").send(validationToken);
    } else {
      res.json({ status: "ok", endpoint: "outlook-webhook" });
    }
  });

  // POST /webhooks/outlook - notification endpoint
  //
  // This path can't sit behind authMiddleware (it's Azure/Graph calling us,
  // not a logged-in user), so it must stay public. Microsoft Graph's
  // documented authenticity check for webhook notifications is the
  // `clientState` value echoed back on every item in the payload — it must
  // match the value we registered when creating the subscription
  // (WEBHOOK_CLIENT_STATE). Reject anything that doesn't match instead of
  // blindly trusting the request body.
  app.post("/webhooks/outlook", express.json(), async (req, res) => {
    const expectedClientState = process.env.WEBHOOK_CLIENT_STATE || "aios-webhook";
    const notifications = Array.isArray(req.body?.value) ? req.body.value : [];
    const allValid =
      notifications.length > 0 &&
      notifications.every((n: { clientState?: unknown }) => n?.clientState === expectedClientState);
    if (!allValid) {
      console.warn("[Webhook] rejected outlook notification: missing/mismatched clientState");
      res.status(401).json({ error: "invalid_client_state" });
      return;
    }
    try {
      await outlookWebhook.handleNotification(req.body);
      res.status(202).json({ status: "accepted" });
    } catch (err) {
      console.error("[Webhook] Error processing notification:", err);
      res.status(500).json({ error: "Failed to process notification" });
    }
  });

  // Error handler
  app.use(errorHandler);

  return app;
}

const isEntrypoint = process.argv[1] === fileURLToPath(import.meta.url);

if (isEntrypoint) {
  const app = createApp();
  const server = app.listen(PORT, HOST, () => {
    console.log(`🚀 AIOS API Server running on port ${PORT}`);
    console.log(`   Health: http://localhost:${PORT}/health`);
    console.log(`   Health (api): http://localhost:${PORT}/api/health`);
  });

  // Handle server-level errors (e.g. EADDRINUSE, EACCES) so an unhandled
  // 'error' event does not crash the process.
  server.on("error", (err: NodeJS.ErrnoException) => {
    console.error(`[Server] listen error on port ${PORT}:`, err.code ?? err.message, err);
  });
}

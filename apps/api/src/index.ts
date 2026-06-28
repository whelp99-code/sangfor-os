/**
 * AIOS API Server
 * Express + tRPC API 서버
 */

import express, { type Express } from "express";
import cors from "cors";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { fileURLToPath } from "node:url";
import {
  probeIntegrationTarget,
  probeAllIntegrationTargets,
  getIntegrationTarget,
  listMcpTools,
  callMcpTool,
} from "@sangfor/infra";
import { appRouter } from "./routers";
import { createContext } from "./context/index";
import { apiKeyMiddleware, authMiddleware, errorHandler, rateLimiter } from "./middleware";
import { metrics } from "@sangfor/infra";
import { createEventRoutes, eventBus } from "./routes/events";
import { createCfoHealthRoutes, createCfoRoutes } from "./routes/cfo";
import { OutlookWebhookHandler } from "@sangfor/api-utils";

const PORT = process.env.API_PORT || 3200;

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

  // Prometheus metrics endpoint
  app.get("/api/metrics", (_req, res) => {
    metrics.setGauge("active_sse_connections", eventBus.getClientCount());
    res.type("text/plain").send(metrics.getMetrics());
  });

  // Health check (before auth middleware, so it's always accessible)
  app.get("/health", (_req, res) => {
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
      res.status(500).json({
        id: "whelp99-code-sangfor-engineer-mcp",
        status: "unreachable",
        upstream: "",
        details: error instanceof Error ? error.message : String(error),
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
      res.status(500).json({
        status: "error",
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // List MCP tools exposed by the whelp99 bridge.
  app.get("/api/whelp99/tools", async (_req, res) => {
    try {
      const tools = await listMcpTools();
      res.json({ tools });
    } catch (error) {
      res.status(502).json({
        error: error instanceof Error ? error.message : String(error),
        tools: [],
      });
    }
  });

  // Invoke an MCP tool through the whelp99 bridge.
  // Body: { name: string, arguments?: Record<string, unknown> }
  app.post("/api/whelp99/tools/call", express.json(), async (req, res) => {
    const name = typeof req.body?.name === "string" ? req.body.name : "";
    if (!name) {
      res.status(400).json({ error: "name is required" });
      return;
    }
    try {
      const args = (req.body?.arguments ?? req.body?.args ?? {}) as Record<string, unknown>;
      const result = await callMcpTool(name, args);
      res.status(result.error ? 502 : 200).json(result);
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : String(error),
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

  // Event routes (SSE - before auth middleware)
  app.use("/api", createEventRoutes());

  // CFO health is public; all other CFO REST routes require API key auth.
  app.use("/api/cfo", createCfoHealthRoutes());

  app.use("/api/cfo", apiKeyMiddleware, createCfoRoutes());

  // Auth middleware for other /api routes
  app.use("/api", authMiddleware);

  // tRPC
  app.use(
    "/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
      onError: ({ error }) => console.error("tRPC Error:", error),
    }),
  );

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
  app.post("/webhooks/outlook", express.json(), async (req, res) => {
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
  app.listen(PORT, () => {
    console.log(`🚀 AIOS API Server running on port ${PORT}`);
    console.log(`   tRPC: http://localhost:${PORT}/trpc`);
    console.log(`   Health: http://localhost:${PORT}/health`);
    console.log(`   Health (api): http://localhost:${PORT}/api/health`);
  });
}

export type { AppRouter } from "./routers";

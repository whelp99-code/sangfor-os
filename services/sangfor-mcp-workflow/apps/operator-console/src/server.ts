import cors from 'cors';
import express, { type Express } from 'express';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Server } from 'node:http';
import { OperationOrchestrator, type McpStdioClient, type ToolRegistry } from '@sangfor/workflow-engine';
import { bootstrapMcpClient } from './bootstrap/mcp-bootstrap.js';
import {
  UnsafeAuthConfigurationError,
  assertSafeWorkflowConfiguration,
} from '../../../packages/shared/src/mutation-policy.js';
import { apiKeyAuth, identityConflictGuard, requireOperatorContext } from './middleware/auth.js';
import { registerAutoOpsRoutes } from './routes/auto-ops-routes.js';
import { registerSystemRoutes } from './routes/system-routes.js';
import {
  createOperatorConsoleContext,
  type OperatorConsoleContext,
} from './server-context.js';

const modulePath = fileURLToPath(import.meta.url);
const publicDirectory = join(dirname(modulePath), 'public');

export function createOperatorApp(context: OperatorConsoleContext): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(cors());
  app.use(express.json());

  // Docker/runtime liveness: always-public process health with uptime.
  // When unset, registerSystemRoutes owns /api/system/health (U002 bootstrap semantics).
  if (process.env.SANGFOR_DOCKER_LIVENESS === '1') {
    app.get('/api/system/health', (_request, response) => {
      response.status(200).json({
        status: 'ok',
        uptime: process.uptime(),
      });
    });
  }

  registerSystemRoutes(app, context);
  // U028: do not mount legacy in-process workflow authority routes.
  app.all(['/api/workflows/:id/approve', '/api/workflows/:id/reject', '/api/break-glass/{*path}'], (_request, response) => {
    response.status(410).json({ error: 'authority_moved', location: '/api/workflow-definitions' });
  });
  app.get('/api/config', (_request, response) => {
    response.json({ workflowAuthority: process.env.SANGFOR_ROOT_URL ? 'root_configured' : 'disabled' });
  });
  registerAutoOpsRoutes(app, context);

  app.use(
    '/api',
    apiKeyAuth,
    requireOperatorContext,
    identityConflictGuard,
    (_request, response) => response.status(404).json({ error: 'NOT_FOUND' }),
  );
  app.use(apiKeyAuth, requireOperatorContext, express.static(publicDirectory));
  app.get('/{*path}', (_request, response) => {
    response.sendFile(join(publicDirectory, 'index.html'));
  });
  return app;
}

function listen(app: Express, port: number, host: string): Promise<Server> {
  return new Promise((resolvePromise, reject) => {
    const server = app.listen(port, host);
    server.once('listening', () => resolvePromise(server));
    server.once('error', reject);
  });
}

function parsePort(value: string | undefined): number {
  const port = Number(value ?? '3500');
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new UnsafeAuthConfigurationError('invalid operator port');
  }
  return port;
}

type OperatorBootstrap = (
  toolRegistry: ToolRegistry,
  workflowCwd: string,
) => Promise<McpStdioClient | null>;

type OperatorBootstrapOptions = Readonly<{
  bootstrap?: OperatorBootstrap;
  isShuttingDown: () => boolean;
}>;

export function installOperatorBootstrap(
  context: OperatorConsoleContext,
  options: OperatorBootstrapOptions,
): void {
  const bootstrap = options.bootstrap ?? bootstrapMcpClient;
  let bootstrapStarted = false;
  context.runtime.requestBootstrap = () => {
    if (bootstrapStarted || options.isShuttingDown() || context.runtime.ready) return;
    bootstrapStarted = true;
    context.runtime.bootstrapTask = bootstrap(context.toolRegistry, context.rootPath)
      .then(async (mcpClient) => {
        if (options.isShuttingDown()) {
          await mcpClient?.stop();
          return;
        }
        if (!mcpClient?.isConnected()) {
          await mcpClient?.stop();
          context.runtime.mcpClient = null;
          context.runtime.ready = false;
          bootstrapStarted = false;
          return;
        }
        mcpClient.setDisconnectHandler(() => {
          if (context.runtime.mcpClient !== mcpClient) return;
          context.runtime.mcpClient = null;
          context.runtime.ready = false;
          bootstrapStarted = false;
        });
        context.runtime.mcpClient = mcpClient;
        context.runtime.ready = true;
      })
      .catch((error: unknown) => {
        context.runtime.mcpClient = null;
        context.runtime.ready = false;
        bootstrapStarted = false;
        process.stderr.write(`[operator-bootstrap] ${error instanceof Error ? error.message : String(error)}\n`);
      });
  };
}

export async function startOperatorServer(): Promise<void> {
  assertSafeWorkflowConfiguration(process.env, 'SANGFOR_API_KEY');
  if (process.env.SANGFOR_TASK_OUTPUT_ROOT) {
    OperationOrchestrator.configureTaskOutputRoot({
      outputRoot: process.env.SANGFOR_TASK_OUTPUT_ROOT,
      attemptRoot: process.env.SANGFOR_TASK_ATTEMPT_ROOT,
    });
  }
  // U006 process identity (nested workspace: U002 assertSafeWorkflowConfiguration
  // is the production gate; monorepo packages/config mirrors the same predicates).
  process.env.SANGFOR_PROCESS_NAME ??= 'workflow-operator';
  const host = process.env.HOST ?? '127.0.0.1';
  // 127.0.0.1 for local/dev containment; 0.0.0.0 only for container publish (auth unchanged).
  if (host !== '127.0.0.1' && host !== '0.0.0.0') {
    throw new UnsafeAuthConfigurationError('operator listener must be loopback or container bind');
  }

  const context = createOperatorConsoleContext();
  let server: Server | null = null;
  let shuttingDown = false;
  installOperatorBootstrap(context, { isShuttingDown: () => shuttingDown });

  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    if (server) {
      await new Promise<void>((resolvePromise, reject) => {
        server?.close((error) => error ? reject(error) : resolvePromise());
      });
    }
    await context.dispose();
  };

  try {
    server = await listen(createOperatorApp(context), parsePort(process.env.PORT), host);
    process.once('SIGTERM', () => void shutdown());
    process.once('SIGINT', () => void shutdown());
  } catch (error) {
    await shutdown();
    throw error;
  }
}

const entrypoint = process.argv[1];
if (entrypoint && resolve(entrypoint) === modulePath) {
  startOperatorServer().catch((error: unknown) => {
    if (error instanceof UnsafeAuthConfigurationError) {
      process.stderr.write(`${error.code}\n`);
      process.exitCode = error.exitCode;
      return;
    }
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

import type { Express } from 'express';
import { apiKeyAuth, identityConflictGuard, requireOperatorContext } from '../middleware/auth.js';
import type { OperatorConsoleContext } from '../server-context.js';

export function registerSystemRoutes(app: Express, context: OperatorConsoleContext): void {
  app.get('/api/system/health', (_request, response) => {
    if (context.runtime.ready && context.runtime.mcpClient?.isConnected()) {
      response.status(200).json({ status: 'ok' });
      return;
    }
    context.runtime.ready = false;
    context.runtime.requestBootstrap();
    response.status(503).json({ status: 'unavailable' });
  });

  app.get('/api/config',
    apiKeyAuth,
    requireOperatorContext,
    identityConflictGuard,
    (_request, response) => {
      response.json({
        authRequired: true,
        mcpConnected: context.runtime.mcpClient?.isConnected() ?? false,
      });
    },
  );
  app.get('/api/dashboard/stats',
    apiKeyAuth,
    requireOperatorContext,
    identityConflictGuard,
    (_request, response) => response.json(context.monitoringDashboard.getStats()),
  );
}

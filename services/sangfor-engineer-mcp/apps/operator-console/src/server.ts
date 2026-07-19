import http from 'node:http';
import { URL } from 'node:url';
import { loadEnvFile } from '../../../packages/sangfor-collector/src/load-env.js';
import {
  authenticateApiKey,
  authorizeHttpContext,
  enforceProductionAuthPreflight,
  extractHttpApiKey,
  findCallerIdentityConflict,
  withServerActor,
  type AuthContext,
} from '../../../packages/shared/src/mutation-policy.js';
import { PRODUCTS } from '../../../packages/shared/src/index.js';
import {
  getEmbeddingHealth,
  getKnowledge,
  getStoreHealth,
  getSummary,
  postAnalyzeProject,
  postAnalyzeRequirements,
  postDiscoverConsole,
  postFeedback,
  postGenerateConfigPlan,
  postImportExcel,
  postRagSearch,
} from './api.js';
import { dashboardHtml } from './ui.js';

loadEnvFile('.env');
enforceProductionAuthPreflight();

const HOST = process.env.HOST ?? '127.0.0.1';
const PORT = Number(process.env.PORT ?? process.env.OPERATOR_CONSOLE_PORT ?? 3502);
let ready = false;
let bootstrapPromise: Promise<void> | null = null;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function json(res: http.ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function error(res: http.ServerResponse, message: string, status = 400): void {
  json(res, { error: message }, status);
}

async function readJsonBody(req: http.IncomingMessage): Promise<Readonly<Record<string, unknown>>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw.trim()) return {};
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed)) throw new Error('JSON body must be an object');
  return parsed;
}

function requireOperator(req: http.IncomingMessage, res: http.ServerResponse): AuthContext | undefined {
  const decision = authorizeHttpContext(authenticateApiKey(extractHttpApiKey(req.headers)));
  if (!decision.allowed) {
    json(res, { error: decision.error }, decision.status);
    return undefined;
  }
  return decision.context;
}

function requestOperatorBootstrap(): void {
  if (ready || bootstrapPromise) return;
  bootstrapPromise = Promise.resolve()
    .then(() => {
      getSummary();
      ready = true;
    })
    .catch((caught: unknown) => {
      bootstrapPromise = null;
      process.stderr.write(`[operator-bootstrap] ${caught instanceof Error ? caught.message : String(caught)}\n`);
    });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${HOST}:${PORT}`);
  const method = req.method ?? 'GET';

  if (method === 'GET' && url.pathname === '/api/health/live') {
    if (ready) return json(res, { status: 'ok' });
    requestOperatorBootstrap();
    return json(res, { status: 'unavailable' }, 503);
  }

  const context = requireOperator(req, res);
  if (!context) return;

  try {
    if (method === 'GET' && url.pathname === '/api/summary') return json(res, getSummary());
    if (method === 'GET' && url.pathname === '/api/products') return json(res, { products: PRODUCTS });
    if (method === 'GET' && url.pathname === '/api/knowledge') {
      return json(res, getKnowledge(url.searchParams.get('product') ?? 'HCI', url.searchParams.get('type') ?? 'manual'));
    }
    if (method === 'GET' && url.pathname === '/api/health/store') return json(res, await getStoreHealth());
    if (method === 'GET' && url.pathname === '/api/health/embeddings') return json(res, await getEmbeddingHealth());

    if (method === 'POST') {
      const body = await readJsonBody(req);
      if (findCallerIdentityConflict(body, context)) return error(res, 'IDENTITY_CONFLICT', 400);
      const attributedBody = withServerActor(body, context);
      if (url.pathname === '/api/analyze-project') {
        if (!body.customerName) return error(res, 'customerName is required');
        return json(res, await postAnalyzeProject(attributedBody));
      }
      if (url.pathname === '/api/generate-config-plan') {
        if (!body.customerName || !body.product) return error(res, 'customerName and product are required');
        return json(res, await postGenerateConfigPlan(attributedBody));
      }
      if (url.pathname === '/api/rag-search') return json(res, await postRagSearch(attributedBody));
      if (url.pathname === '/api/discover-console') return json(res, await postDiscoverConsole(attributedBody));
      if (url.pathname === '/api/analyze-requirements') {
        if (!Array.isArray(body.requirements) || body.requirements.length === 0) return error(res, 'requirements array is required');
        return json(res, await postAnalyzeRequirements(attributedBody));
      }
      if (url.pathname === '/api/import-excel') return json(res, await postImportExcel(attributedBody));
      if (url.pathname === '/api/feedback') {
        if (!body.product || !body.feedbackText) return error(res, 'product and feedbackText are required');
        return json(res, await postFeedback(attributedBody));
      }
    }

    if (method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(dashboardHtml());
      return;
    }
    res.writeHead(404);
    res.end('Not found');
  } catch (caught) {
    error(res, caught instanceof Error ? caught.message : String(caught), 500);
  }
});

server.listen(PORT, HOST, () => {
  process.stdout.write(`Sangfor Engineer Web listening on http://${HOST}:${PORT}\n`);
  process.stdout.write('MCP stdio server: pnpm run dev:mcp (unchanged for Cursor)\n');
});

function shutdown(): void {
  ready = false;
  server.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

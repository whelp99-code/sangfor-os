/** U028 stateless client for the U025 workflow root.  It owns no workflow data. */
import { createHash, createHmac, randomBytes } from 'node:crypto';

export type CanonicalWorkflowScope = Readonly<{ tenantId: string; companyId: string; projectId: string }>;
type WorkflowEnv = Readonly<Record<string, string | undefined>>;
type FetchLike = (request: Request) => Promise<Response>;

const WORKFLOW = Object.freeze({
  issuer: 'sangfor-mcp-workflow', audience: 'sangfor-web-workflow', serviceId: 'sangfor-mcp-workflow',
});

const capabilityFor = (method: string, path: string): string => {
  let normalizedPath = path;
  if (path.startsWith("/api/opportunities/") && path.endsWith("/workflow-runs")) {
    normalizedPath = "/api/opportunities/:id/workflow-runs";
  } else {
    normalizedPath = path.replace(/\/[A-Za-z0-9_-]+(?=\/activate$|$)/, '/:id');
  }
  const route = `${method} ${normalizedPath}`;
  const capabilities: Record<string, string> = {
    'POST /api/workflow-definitions': 'workflow.definition.create',
    'GET /api/workflow-definitions': 'workflow.definition.read',
    'POST /api/workflow-definitions/:id/activate': 'workflow.definition.activate',
    'POST /api/workflow-runs': 'workflow.run.create',
    'GET /api/workflow-runs/:id': 'workflow.run.read',
    'PATCH /api/workflow-runs/:id': 'workflow.run.callback',
    'POST /api/opportunities/:id/workflow-runs': 'workflow.run.create',
  };
  const capability = capabilities[route];
  if (!capability) throw new CanonicalWorkflowError('INVALID_ROUTE', `no WORKFLOW capability for ${route}`);
  return capability;
};

function canonical(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
  }
  throw new CanonicalWorkflowError('INVALID_BODY', 'body must be JSON-canonicalizable');
}
const b64 = (value: string | Buffer) => Buffer.from(value).toString('base64url');
const digest = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');

type ParsedConfig = Readonly<{ rootUrl: string; kid: string; secret: Buffer }>;
function parseConfig(env: WorkflowEnv): ParsedConfig {
  const rootUrl = env.SANGFOR_ROOT_URL?.trim();
  if (!rootUrl) throw new CanonicalWorkflowError('INVALID_CONFIGURATION', 'SANGFOR_ROOT_URL is required');
  let root: URL;
  try { root = new URL(rootUrl); } catch { throw new CanonicalWorkflowError('INVALID_CONFIGURATION', 'SANGFOR_ROOT_URL must be absolute'); }
  if (!['http:', 'https:'].includes(root.protocol) || root.search || root.hash) throw new CanonicalWorkflowError('INVALID_CONFIGURATION', 'SANGFOR_ROOT_URL is invalid');
  if (env.INTERNAL_PRINCIPAL_TTL_SECONDS !== '60' || env.INTERNAL_PRINCIPAL_CLOCK_SKEW_SECONDS !== '5' || env.INTERNAL_PRINCIPAL_ROTATION_OWNER !== 'security-auth') {
    throw new CanonicalWorkflowError('INVALID_CONFIGURATION', 'U026 fixed principal constants are required');
  }
  const kid = env.INTERNAL_PRINCIPAL_WORKFLOW_ACTIVE_KID?.trim();
  if (!kid || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(kid)) throw new CanonicalWorkflowError('INVALID_CONFIGURATION', 'WORKFLOW active kid is invalid');
  let ring: unknown;
  try { ring = JSON.parse(env.INTERNAL_PRINCIPAL_WORKFLOW_KEYRING_JSON ?? ''); } catch { throw new CanonicalWorkflowError('INVALID_CONFIGURATION', 'WORKFLOW keyring is invalid'); }
  const keys = typeof ring === 'object' && ring !== null && (ring as { version?: unknown }).version === 'sangfor.internal-principal-keyring/v1' && Array.isArray((ring as { keys?: unknown }).keys) ? (ring as { keys: Array<Record<string, unknown>> }).keys : null;
  const active = keys?.find((key) => key.kid === kid && key.state === 'active');
  if (!active || typeof active.secretBase64Url !== 'string') throw new CanonicalWorkflowError('INVALID_CONFIGURATION', 'WORKFLOW active key is unavailable');
  const secret = Buffer.from(active.secretBase64Url, 'base64url');
  if (secret.length !== 32 || secret.toString('base64url') !== active.secretBase64Url) throw new CanonicalWorkflowError('INVALID_CONFIGURATION', 'WORKFLOW key is malformed');
  return { rootUrl: root.toString().replace(/\/$/, ''), kid, secret };
}

export class CanonicalWorkflowError extends Error {
  constructor(readonly code: 'INVALID_CONFIGURATION' | 'INVALID_ROUTE' | 'INVALID_BODY' | 'ROOT_UNAVAILABLE' | 'ROOT_REJECTED' | 'ROOT_PROTOCOL', message: string) { super(message); this.name = 'CanonicalWorkflowError'; }
}

export class CanonicalWorkflowClient {
  private readonly config: ParsedConfig;
  private readonly fetcher: FetchLike;
  private readonly scope: CanonicalWorkflowScope;
  private state: 'connected' | 'degraded' = 'degraded';

  constructor(options: Readonly<{ environment: WorkflowEnv; scope: CanonicalWorkflowScope; fetch?: FetchLike }>) {
    this.config = parseConfig(options.environment);
    this.scope = options.scope;
    if (!this.scope.tenantId || !this.scope.companyId || !this.scope.projectId) throw new CanonicalWorkflowError('INVALID_CONFIGURATION', 'server-derived root scope is required');
    this.fetcher = options.fetch ?? fetch;
  }
  status(): Readonly<{ state: 'connected' | 'degraded' }> { return { state: this.state }; }
  async createDefinition(body: Record<string, unknown>): Promise<unknown> { return this.request('POST', '/api/workflow-definitions', body); }
  async listDefinitions(): Promise<unknown> { return this.request('GET', '/api/workflow-definitions'); }
  async activateDefinition(id: string, body: Record<string, unknown>): Promise<unknown> { return this.request('POST', `/api/workflow-definitions/${id}/activate`, body); }
  async startRun(body: Record<string, unknown>): Promise<unknown> { return this.request('POST', '/api/workflow-runs', body); }
  async getRun(id: string): Promise<unknown> { return this.request('GET', `/api/workflow-runs/${id}`); }
  async appendCallback(id: string, body: Record<string, unknown>): Promise<unknown> { return this.request('PATCH', `/api/workflow-runs/${id}`, body); }
  async startDealWorkflow(opportunityId: string, idempotencyKey: string): Promise<unknown> { return this.request('POST', `/api/opportunities/${opportunityId}/workflow-runs`, { idempotencyKey }); }

  private async request(method: string, path: string, bodyValue?: Record<string, unknown>): Promise<unknown> {
    const body = bodyValue === undefined ? '' : canonical(bodyValue);
    const capability = capabilityFor(method, path);
    const now = Math.floor(Date.now() / 1_000);
    const header = { alg: 'HS256', kid: this.config.kid, typ: 'sangfor-internal-principal+jwt', v: 1 };
    const payload = {
      audience: WORKFLOW.audience, bodyHash: digest(body), businessRole: null, capabilities: [capability], companyId: this.scope.companyId,
      exp: now + 60, iat: now, idempotencyKey: b64(randomBytes(16)), issuer: WORKFLOW.issuer, jti: b64(randomBytes(16)), method,
      nbf: now - 5, nonce: b64(randomBytes(16)), path, profile: 'WORKFLOW', projectId: this.scope.projectId, queryHash: digest(''),
      sessionId: null, subjectId: WORKFLOW.serviceId, subjectType: 'service', tenantId: this.scope.tenantId,
    };
    const signed = `${b64(canonical(header))}.${b64(canonical(payload))}`;
    const envelope = `${signed}.${createHmac('sha256', this.config.secret).update(signed, 'utf8').digest('base64url')}`;
    try {
      const response = await this.fetcher(new Request(`${this.config.rootUrl}${path}`, { method, headers: { 'content-type': 'application/json', 'x-sangfor-internal-principal': envelope }, body: body || undefined }));
      if (!response.ok) throw new CanonicalWorkflowError('ROOT_REJECTED', `root returned ${response.status}`);
      const parsed: unknown = await response.json();
      this.state = 'connected';
      if (typeof parsed !== 'object' || parsed === null) throw new CanonicalWorkflowError('ROOT_PROTOCOL', 'root response is not an object');
      const record = parsed as Record<string, unknown>;
      return record.definition ?? record.run ?? record.runs ?? record.definitions ?? record;
    } catch (error) {
      this.state = 'degraded';
      if (error instanceof CanonicalWorkflowError) throw error;
      throw new CanonicalWorkflowError('ROOT_UNAVAILABLE', error instanceof Error ? error.message : 'root unavailable');
    }
  }
}

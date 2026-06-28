/**
 * @sangfor/infra - Integration Registry & Probes
 *
 * Real wiring between the monorepo and the containerized MCP services that live
 * under services/* (see docker-compose.yml). Replaces the previous stubs that
 * always returned status: 'unknown'.
 *
 * Targets are resolved against the single source of truth for ports
 * (@sangfor/config PORT_REGISTRY) and probed over HTTP against the health
 * endpoint each service actually exposes.
 */

import { getUrl } from '@sangfor/config';

export type IntegrationStatus = 'healthy' | 'degraded' | 'unreachable' | 'unknown';

export interface IntegrationTarget {
  /** Stable identifier (matches the services/* directory name where applicable). */
  id: string;
  status: IntegrationStatus;
  /** Fully-qualified health URL that probeIntegrationTarget() will fetch. */
  upstream: string;
  details?: string;
  readinessNote?: string;
  latencyMs?: number;
}

/** join a base URL (no trailing slash assumption) with a path. */
function joinUrl(base: string, path: string): string {
  if (!path) return base;
  return `${base.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
}

/** Resolve the MCP HTTP bridge base URL (env override → port registry default). */
function bridgeBaseUrl(): string {
  return process.env.WHELP99_MCP_HTTP_URL ?? getUrl('WHELP99_MCP_BRIDGE');
}

/**
 * Registry of known integration targets. Each entry resolves its health URL
 * lazily so env overrides are honored at call time (important for tests/CI).
 */
const REGISTRY: Record<string, { upstream: () => string; readinessNote: string }> = {
  'whelp99-code-sangfor-engineer-mcp': {
    upstream: () => joinUrl(bridgeBaseUrl(), '/health'),
    readinessNote: 'MCP HTTP bridge (stdio MCP wrapper) — GET /health',
  },
  'sangfor-mcp-workflow': {
    upstream: () => getUrl('SANGFOR_MCP', '/api/system/health'),
    readinessNote: 'Operator console / workflow engine — GET /api/system/health',
  },
  'sangfor-engineer-operator-console': {
    upstream: () => getUrl('WHELP99_OPERATOR_CONSOLE', '/api/health/store'),
    readinessNote: 'Engineer operator console — GET /api/health/store',
  },
  'sangfor-mock-console': {
    upstream: () => getUrl('SANGFOR_MOCK_CONSOLE', '/'),
    readinessNote: 'Mock Sangfor console — GET /',
  },
};

/** List the ids of every registered integration target. */
export function listIntegrationTargets(): string[] {
  return Object.keys(REGISTRY);
}

/**
 * Resolve a target's metadata (id + upstream health URL). Status is 'unknown'
 * until probeIntegrationTarget() is called. Unknown names return an inert
 * target with no upstream so callers degrade gracefully.
 */
export function getIntegrationTarget(name: string): IntegrationTarget {
  const entry = REGISTRY[name];
  if (!entry) {
    return {
      id: name,
      status: 'unknown',
      upstream: '',
      readinessNote: `Unknown integration target: ${name}`,
    };
  }
  return {
    id: name,
    status: 'unknown',
    upstream: entry.upstream(),
    readinessNote: entry.readinessNote,
  };
}

export interface ProbeOptions {
  /** Abort the probe after this many ms (default 3000). */
  timeoutMs?: number;
  /** Inject a fetch implementation (tests). Defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

/**
 * Probe a target over HTTP and return it with a resolved status.
 * - 2xx        → healthy
 * - other HTTP → degraded (service up but not OK)
 * - no/timeout → unreachable
 * - no upstream → unknown (cannot probe)
 */
export async function probeIntegrationTarget(
  target: IntegrationTarget,
  opts: ProbeOptions = {},
): Promise<IntegrationTarget> {
  if (!target.upstream) {
    return {
      ...target,
      status: 'unknown',
      details: target.readinessNote ?? 'no upstream configured',
    };
  }

  const timeoutMs = opts.timeoutMs ?? 3000;
  const doFetch = opts.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();

  try {
    const res = await doFetch(target.upstream, { signal: controller.signal });
    const latencyMs = Date.now() - started;
    let details: string | undefined;
    try {
      details = (await res.text()).slice(0, 500);
    } catch {
      /* body not readable — keep status only */
    }
    return {
      ...target,
      status: res.ok ? 'healthy' : 'degraded',
      latencyMs,
      details: details || `HTTP ${res.status}`,
    };
  } catch (error) {
    return {
      ...target,
      status: 'unreachable',
      latencyMs: Date.now() - started,
      details: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Probe every registered target concurrently. */
export function probeAllIntegrationTargets(
  opts: ProbeOptions = {},
): Promise<IntegrationTarget[]> {
  return Promise.all(
    listIntegrationTargets().map((id) => probeIntegrationTarget(getIntegrationTarget(id), opts)),
  );
}

/**
 * Workspace root used to resolve relative service paths. Honors AIOS_WORKSPACE_ROOT
 * when set (e.g. inside containers), otherwise the current working directory.
 */
export function resolveAiosWorkspaceRoot(): string {
  return process.env.AIOS_WORKSPACE_ROOT ?? process.cwd();
}

/**
 * AIOS v3 Bridge
 *
 * Imports and re-exports key functionality from the @aios/* F-aios-v3-core
 * packages so that AIOS v1 code can interact with v3 services through a
 * single, stable import path.
 *
 * The bridge also provides lightweight wrapper functions that handle
 * configuration resolution, timeout management, and error normalisation.
 *
 * Packages bridged:
 * - @aios/workflow    → workflow execution & orchestration
 * - @aios/monitoring  → health checks, metrics, APM
 * - @aios/lightrag    → knowledge graph queries & ingestion
 */

import {
  getAiosV3Config,
  getAiosV3ServerUrl,
  getLmStudioUrl,
  type AiosV3ServiceConfig,
} from "./aios-v3-config";

// ---------------------------------------------------------------------------
// Re-export config utilities so consumers can import from the bridge directly
// ---------------------------------------------------------------------------
export { getAiosV3Config, getAiosV3ServerUrl, getLmStudioUrl };
export type { AiosV3ServiceConfig };

// ---------------------------------------------------------------------------
// Shared fetch helper with timeout support
// ---------------------------------------------------------------------------
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// @aios/workflow  – Workflow execution
// ---------------------------------------------------------------------------

export interface WorkflowExecutionRequest {
  /** Unique identifier for the workflow definition */
  workflowId: string;
  /** Input payload passed to the workflow */
  input: Record<string, unknown>;
  /** Optional run metadata (caller, correlation id, etc.) */
  metadata?: Record<string, unknown>;
}

export interface WorkflowExecutionResponse {
  runId: string;
  status: "completed" | "failed" | "running";
  output?: unknown;
  error?: string;
  startedAt: string;
  completedAt?: string;
}

/**
 * Execute a workflow on the F-aios-v3-core server.
 *
 * Delegates to `POST /api/workflow/run` on the v3 server.
 */
export async function executeWorkflow(
  request: WorkflowExecutionRequest,
): Promise<WorkflowExecutionResponse> {
  const config = getAiosV3Config();
  const url = `${config.serverBaseUrl}/api/workflow/run`;

  if (config.debug) {
    console.debug("[aios-v3-bridge] executeWorkflow →", url, request);
  }

  const response = await fetchWithTimeout(
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    },
    config.serverTimeoutMs,
  );

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Workflow execution failed: ${response.status} ${response.statusText} – ${body}`,
    );
  }

  return (await response.json()) as WorkflowExecutionResponse;
}

/**
 * Retrieve the status of a previously started workflow run.
 */
export async function getWorkflowStatus(
  runId: string,
): Promise<WorkflowExecutionResponse> {
  const config = getAiosV3Config();
  const url = `${config.serverBaseUrl}/api/workflow/runs/${runId}`;

  const response = await fetchWithTimeout(url, { method: "GET" }, config.serverTimeoutMs);

  if (!response.ok) {
    throw new Error(`Workflow status fetch failed: ${response.status}`);
  }

  return (await response.json()) as WorkflowExecutionResponse;
}

// ---------------------------------------------------------------------------
// @aios/monitoring – Health & metrics
// ---------------------------------------------------------------------------

export interface MonitoringHealthResponse {
  status: "ok" | "degraded" | "error";
  services: Record<string, { status: string; latencyMs?: number }>;
  timestamp: string;
}

/**
 * Query the health endpoint of the v3 monitoring subsystem.
 */
export async function getMonitoringHealth(): Promise<MonitoringHealthResponse> {
  const config = getAiosV3Config();
  const url = `${config.serverBaseUrl}/api/monitoring/health`;

  const response = await fetchWithTimeout(url, { method: "GET" }, 5_000);

  if (!response.ok) {
    return {
      status: "error",
      services: {},
      timestamp: new Date().toISOString(),
    };
  }

  return (await response.json()) as MonitoringHealthResponse;
}

// ---------------------------------------------------------------------------
// @aios/lightrag – Knowledge graph queries
// ---------------------------------------------------------------------------

export interface LightRagQueryRequest {
  query: string;
  mode?: "naive" | "local" | "global" | "hybrid" | "mix";
  response_type?: "Single Paragraph" | "Multiple Paragraphs" | "List";
}

export interface LightRagQueryResponse {
  response?: string;
  contexts?: unknown[];
}

/**
 * Execute a LightRAG knowledge graph query via the v3 server.
 */
export async function queryLightRagV3(
  request: LightRagQueryRequest,
): Promise<LightRagQueryResponse> {
  const config = getAiosV3Config();
  const url = `${config.serverBaseUrl}/api/lightrag/query`;

  if (config.debug) {
    console.debug("[aios-v3-bridge] queryLightRagV3 →", url, request);
  }

  const response = await fetchWithTimeout(
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: request.query,
        mode: request.mode ?? "mix",
        stream: false,
        response_type: request.response_type ?? "Multiple Paragraphs",
      }),
    },
    config.serverTimeoutMs,
  );

  if (!response.ok) {
    throw new Error(`LightRAG query failed: ${response.status}`);
  }

  return (await response.json()) as LightRagQueryResponse;
}

/**
 * Ingest text into the LightRAG knowledge base via the v3 server.
 */
export async function ingestLightRagTextV3(
  text: string,
  fileSource = "aios-knowledge.txt",
): Promise<{ status?: string; message?: string; track_id?: string }> {
  const config = getAiosV3Config();
  const url = `${config.serverBaseUrl}/api/lightrag/documents/text`;

  const response = await fetchWithTimeout(
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, file_source: fileSource }),
    },
    config.serverTimeoutMs,
  );

  if (!response.ok) {
    throw new Error(`LightRAG ingest failed: ${response.status}`);
  }

  return (await response.json());
}

// ---------------------------------------------------------------------------
// @aios/lightrag – LM Studio integration helpers
// ---------------------------------------------------------------------------

export interface LmStudioModelsResponse {
  data: Array<{ id: string; object: string }>;
}

/**
 * List available models from the LM Studio instance.
 */
export async function listLmStudioModels(): Promise<LmStudioModelsResponse> {
  const config = getAiosV3Config();
  const url = `${config.lmStudioBaseUrl}/v1/models`;

  const response = await fetchWithTimeout(url, { method: "GET" }, config.lmStudioTimeoutMs);

  if (!response.ok) {
    throw new Error(`LM Studio model list failed: ${response.status}`);
  }

  return (await response.json()) as LmStudioModelsResponse;
}

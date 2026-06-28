/**
 * @sangfor/infra — Engineer operator-console client
 *
 * Typed client over the engineer-mcp operator console (services/sangfor-engineer-mcp,
 * apps/operator-console, port WHELP99_OPERATOR_CONSOLE=3502). Surfaces the
 * higher-level capabilities (analyze/plan, RAG search, products, knowledge) used
 * by cross-service workflows and the portal Knowledge Search screen.
 */

import { getUrl } from "@sangfor/config";

import { HttpStatusError, withRetry } from "./resilience";

export interface EngineerConsoleOptions {
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface RagHit {
  id?: string;
  text?: string;
  score?: number;
  source?: string;
  product?: string;
  [k: string]: unknown;
}
export interface RagSearchResult {
  query?: string;
  results?: RagHit[];
  [k: string]: unknown;
}

export interface ProductInfo {
  id?: string;
  name?: string;
  family?: string;
  [k: string]: unknown;
}
export interface ProductsResult {
  products?: ProductInfo[];
  [k: string]: unknown;
}

export interface KnowledgeItem {
  title?: string;
  section?: string;
  content?: string;
  [k: string]: unknown;
}
export interface KnowledgeResult {
  product?: string;
  type?: string;
  items?: KnowledgeItem[];
  [k: string]: unknown;
}

function consoleBaseUrl(override?: string): string {
  return override ?? process.env.WHELP99_OPERATOR_CONSOLE_URL ?? getUrl("WHELP99_OPERATOR_CONSOLE");
}

async function request<T>(
  method: "GET" | "POST",
  path: string,
  body: unknown,
  opts: EngineerConsoleOptions = {},
): Promise<T> {
  const doFetch = opts.fetchImpl ?? fetch;
  // Retry transient failures (network errors / 5xx); never retry 4xx.
  return withRetry(async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 30_000);
    try {
      const res = await doFetch(`${consoleBaseUrl(opts.baseUrl)}${path}`, {
        method,
        headers: method === "POST" ? { "content-type": "application/json" } : undefined,
        body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
        signal: controller.signal,
      });
      if (!res.ok) throw new HttpStatusError(res.status, `engineer-console ${path} failed: HTTP ${res.status}`);
      return (await res.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  });
}

export const engineerConsole = {
  analyzeProject: (body: Record<string, unknown>, opts?: EngineerConsoleOptions) =>
    request<unknown>("POST", "/api/analyze-project", body, opts),
  generateConfigPlan: (body: Record<string, unknown>, opts?: EngineerConsoleOptions) =>
    request<unknown>("POST", "/api/generate-config-plan", body, opts),
  analyzeRequirements: (body: Record<string, unknown>, opts?: EngineerConsoleOptions) =>
    request<unknown>("POST", "/api/analyze-requirements", body, opts),
  ragSearch: (body: Record<string, unknown>, opts?: EngineerConsoleOptions) =>
    request<RagSearchResult>("POST", "/api/rag-search", body, opts),
  summary: (opts?: EngineerConsoleOptions) => request<unknown>("GET", "/api/summary", undefined, opts),
  products: (opts?: EngineerConsoleOptions) =>
    request<ProductsResult>("GET", "/api/products", undefined, opts),
  knowledge: (product: string, type: string, opts?: EngineerConsoleOptions) =>
    request<KnowledgeResult>(
      "GET",
      `/api/knowledge?product=${encodeURIComponent(product)}&type=${encodeURIComponent(type)}`,
      undefined,
      opts,
    ),
};

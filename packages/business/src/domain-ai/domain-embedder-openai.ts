import type { Embedder } from "./domain-embedding";
import { createHashEmbedder } from "./domain-embedder";
import { getOpenAiApiKey, getOpenAiBaseUrl, getOpenAiAuthHeaders } from "../platform/openai-config";

/**
 * 실제 임베딩 제공자(OpenAI 호환). 키가 있으면 /embeddings 호출, 없으면 로컬 해시로 폴백.
 * `Embedder` 시그니처가 같아 backfill/recall 어디서든 교체 가능.
 */

export interface OpenAiEmbedderOptions {
  model?: string;
  baseUrl?: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
}

export function createOpenAiEmbedder(opts: OpenAiEmbedderOptions = {}): Embedder {
  return async (text: string) => {
    const apiKey = opts.apiKey ?? getOpenAiApiKey();
    if (!apiKey) throw new Error("openai embedder: no API key (set OPENAI_API_KEY)");
    const base = (opts.baseUrl ?? getOpenAiBaseUrl()).replace(/\/+$/, "");
    const model = opts.model ?? process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small";
    const f = opts.fetchImpl ?? globalThis.fetch;
    const res = await f(`${base}/embeddings`, {
      method: "POST",
      headers: { "content-type": "application/json", ...getOpenAiAuthHeaders(apiKey) },
      body: JSON.stringify({ model, input: text }),
    });
    if (!res.ok) throw new Error(`openai embeddings failed: ${res.status} ${res.statusText}`);
    const json = (await res.json()) as { data?: Array<{ embedding?: number[] }> };
    return json.data?.[0]?.embedding ?? [];
  };
}

export interface ResolveEmbedderOptions extends OpenAiEmbedderOptions {
  /** 해시 폴백 차원 (기본 256). */
  dim?: number;
}

// 채팅 9router(:20128)에는 임베딩 모델이 없어 임베딩만 별도 백엔드(EMBEDDING_BASE_URL)로 분리한다.
function embeddingEndpoint(opts: ResolveEmbedderOptions): OpenAiEmbedderOptions | null {
  const baseUrl = opts.baseUrl ?? process.env.EMBEDDING_BASE_URL;
  if (!baseUrl) return null;
  return {
    baseUrl,
    model: opts.model ?? process.env.EMBEDDING_MODEL ?? "nomic-embed-text",
    apiKey: opts.apiKey ?? process.env.EMBEDDING_API_KEY ?? "ollama",
    fetchImpl: opts.fetchImpl,
  };
}

/** 임베딩 엔드포인트가 있으면 그것을, 아니면 OpenAI 키 있으면 OpenAI, 없으면 로컬 해시(오프라인). */
export function resolveEmbedder(opts: ResolveEmbedderOptions = {}): Embedder {
  const endpoint = embeddingEndpoint(opts);
  if (endpoint) return createOpenAiEmbedder(endpoint);
  const apiKey = opts.apiKey ?? getOpenAiApiKey();
  return apiKey ? createOpenAiEmbedder(opts) : createHashEmbedder(opts.dim ?? 256);
}

/** 현재 환경에서 어떤 임베더가 쓰일지 (로깅용). */
export function describeEmbedder(opts: ResolveEmbedderOptions = {}): "embedding-endpoint" | "openai" | "hash" {
  if (embeddingEndpoint(opts)) return "embedding-endpoint";
  return (opts.apiKey ?? getOpenAiApiKey()) ? "openai" : "hash";
}

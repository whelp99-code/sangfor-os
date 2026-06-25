import type { KnowledgeCitation } from "@sangfor/business/knowledge-search";

type LightRagQueryResponse = {
  response?: string;
  contexts?: unknown;
};

type LightRagDocActionResponse = {
  status?: string;
  message?: string;
  track_id?: string;
};

export type LightRagSearchResult = {
  citations: KnowledgeCitation[];
  backend: "lightrag";
};

const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_QUERY_MODE = "mix";

function getBaseUrl() {
  return process.env.LIGHTRAG_BASE_URL?.replace(/\/$/, "");
}

function getTimeoutMs() {
  const raw = process.env.LIGHTRAG_TIMEOUT_MS;
  if (!raw) return DEFAULT_TIMEOUT_MS;

  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
}

function getQueryMode() {
  return process.env.LIGHTRAG_QUERY_MODE || DEFAULT_QUERY_MODE;
}

function isLightRagEnabled() {
  return process.env.KNOWLEDGE_BACKEND === "lightrag" && Boolean(getBaseUrl());
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = DEFAULT_TIMEOUT_MS,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function contextToText(context: unknown): string | null {
  if (typeof context === "string") return context.trim() || null;
  if (!context || typeof context !== "object") return null;

  const record = context as Record<string, unknown>;
  const candidates = [
    record.content,
    record.text,
    record.chunk,
    record.description,
    record.summary,
  ];
  const value = candidates.find((item): item is string => typeof item === "string");
  return value?.trim() || null;
}

function contextsToCitations(contexts: unknown): KnowledgeCitation[] {
  if (!Array.isArray(contexts)) return [];

  return contexts
    .map((context, index) => {
      const text = contextToText(context);
      if (!text) return null;

      const source =
        typeof context === "object" &&
        context !== null &&
        typeof (context as Record<string, unknown>).source === "string"
          ? ((context as Record<string, unknown>).source as string)
          : "lightrag-context";

      return {
        documentId: `lightrag-context-${index}`,
        title: `LightRAG context ${index + 1}`,
        chunkIndex: index,
        excerpt: text.slice(0, 500),
        source,
      };
    })
    .filter((item): item is KnowledgeCitation => Boolean(item));
}

export function normalizeLightRagCitations(
  query: string,
  data: LightRagQueryResponse,
): KnowledgeCitation[] {
  const contextCitations = contextsToCitations(data.contexts);
  if (contextCitations.length > 0) return contextCitations;

  const answer = data.response?.trim();
  if (!answer) return [];

  return [
    {
      documentId: "lightrag",
      title: `LightRAG answer: ${query.slice(0, 80)}`,
      chunkIndex: 0,
      excerpt: answer,
      source: "lightrag",
    },
  ];
}

export async function queryLightRag(
  query: string,
): Promise<LightRagSearchResult | null> {
  const baseUrl = getBaseUrl();
  if (!isLightRagEnabled() || !baseUrl) return null;

  const response = await fetchWithTimeout(`${baseUrl}/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query,
      mode: getQueryMode(),
      stream: false,
      response_type: "Multiple Paragraphs",
    }),
  }, getTimeoutMs());

  if (!response.ok) {
    throw new Error(`LightRAG query failed: ${response.status}`);
  }

  const data = (await response.json()) as LightRagQueryResponse;
  const citations = normalizeLightRagCitations(query, data);
  return citations.length > 0 ? { citations, backend: "lightrag" } : null;
}

export async function ingestLightRagText(
  text: string,
  fileSource = "aios-knowledge.txt",
): Promise<LightRagDocActionResponse | null> {
  const baseUrl = getBaseUrl();
  if (
    process.env.KNOWLEDGE_INGEST_ENABLED !== "true" ||
    !isLightRagEnabled() ||
    !baseUrl
  ) {
    return null;
  }

  const response = await fetchWithTimeout(`${baseUrl}/documents/text`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, file_source: fileSource }),
  }, getTimeoutMs());

  if (!response.ok) {
    throw new Error(`LightRAG ingest failed: ${response.status}`);
  }

  return (await response.json()) as LightRagDocActionResponse;
}

export async function getLightRagStatus() {
  const baseUrl = getBaseUrl();
  if (!baseUrl) {
    return { enabled: false, status: "not_configured" as const };
  }

  try {
    const response = await fetchWithTimeout(
      `${baseUrl}/health`,
      {
        method: "GET",
        headers: { Accept: "application/json" },
      },
      3_000,
    );

    if (!response.ok) {
      return { enabled: isLightRagEnabled(), status: "unhealthy" as const };
    }

    return {
      enabled: isLightRagEnabled(),
      status: "healthy" as const,
      details: await response.json(),
    };
  } catch (error) {
    return {
      enabled: isLightRagEnabled(),
      status: "unreachable" as const,
      error: error instanceof Error ? error.message : "unknown_error",
    };
  }
}

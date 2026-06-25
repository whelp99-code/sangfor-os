import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ingestLightRagText,
  normalizeLightRagCitations,
  queryLightRag,
} from "./lightrag-client";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  vi.unstubAllGlobals();
});

describe("queryLightRag", () => {
  it("returns null when LightRAG is not enabled", async () => {
    process.env.KNOWLEDGE_BACKEND = "db";
    process.env.LIGHTRAG_BASE_URL = "http://localhost:9621";

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(queryLightRag("release risks")).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("normalizes a LightRAG answer into AIOS citations", async () => {
    process.env.KNOWLEDGE_BACKEND = "lightrag";
    process.env.LIGHTRAG_BASE_URL = "http://localhost:9621/";
    process.env.LIGHTRAG_QUERY_MODE = "hybrid";
    process.env.LIGHTRAG_TIMEOUT_MS = "1234";

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ response: "Use the release checklist as the source of truth." }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await queryLightRag("What is the release source of truth?");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:9621/query",
      expect.objectContaining({
        body: expect.stringContaining('"mode":"hybrid"'),
        method: "POST",
      }),
    );
    expect(result).toEqual({
      backend: "lightrag",
      citations: [
        expect.objectContaining({
          documentId: "lightrag",
          excerpt: "Use the release checklist as the source of truth.",
          source: "lightrag",
        }),
      ],
    });
  });

  it("prefers retrieved contexts when LightRAG returns them", () => {
    const citations = normalizeLightRagCitations("release", {
      response: "fallback answer",
      contexts: [
        { content: "Checklist context", source: "release.md" },
        "Plain text context",
      ],
    });

    expect(citations).toEqual([
      expect.objectContaining({
        excerpt: "Checklist context",
        source: "release.md",
      }),
      expect.objectContaining({
        excerpt: "Plain text context",
        source: "lightrag-context",
      }),
    ]);
  });
});

describe("ingestLightRagText", () => {
  it("does not ingest unless explicitly enabled", async () => {
    process.env.KNOWLEDGE_BACKEND = "lightrag";
    process.env.KNOWLEDGE_INGEST_ENABLED = "false";
    process.env.LIGHTRAG_BASE_URL = "http://localhost:9621";

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(ingestLightRagText("hello")).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends file_source when ingest is enabled", async () => {
    process.env.KNOWLEDGE_BACKEND = "lightrag";
    process.env.KNOWLEDGE_INGEST_ENABLED = "true";
    process.env.LIGHTRAG_BASE_URL = "http://localhost:9621";

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: "success", track_id: "t1" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await ingestLightRagText("hello", "mail-abc.txt");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:9621/documents/text",
      expect.objectContaining({
        body: JSON.stringify({ text: "hello", file_source: "mail-abc.txt" }),
      }),
    );
  });
});

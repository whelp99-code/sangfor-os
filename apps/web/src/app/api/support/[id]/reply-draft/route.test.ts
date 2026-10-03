import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  coarse: vi.fn(), session: vi.fn(), context: vi.fn(),
  transaction: vi.fn(), findCase: vi.fn(), rag: vi.fn(),
}));
vi.mock("@/lib/api-auth", () => ({ assertApiAccess: mocks.coarse,
  apiError: (error: string, _details: unknown, options: { status: number }) => Response.json({ error }, { status: options.status }) }));
vi.mock("@/lib/auth/authorization", () => ({ resolveBusinessCapabilityContext: mocks.context }));
vi.mock("@/lib/auth/persisted-session", () => ({ evaluatePersistedSessionFromRequest: mocks.session }));
vi.mock("@sangfor/db", () => ({ withRlsTransaction: mocks.transaction }));
vi.mock("@sangfor/infra", () => ({ engineerConsole: { ragSearch: mocks.rag } }));
vi.mock("@sangfor/business", async () => ({
  ...await import("../../../../../../../../packages/business/src/support/support-reply-draft"),
}));

import { POST } from "./route";

const scope = { userId: "user-1", tenantId: "tenant-1", companyId: "company-1", projectId: "project-1", businessRole: "support_engineer" };
const body = { topic: "kernel_patch", query: "Synthetic patch question", product: "HCI", version: "fixture-1" };
const sourceText = "Synthetic manual quote. No real compatibility claim.";
const hit = { id: "chunk-1", title: "Synthetic manual", text: sourceText, source: "https://support.sangfor.com/synthetic-fixture",
  product: "HCI", version: "fixture-1", trustLevel: "official", sourceVisibility: "public", customerShareable: true, textSha256: createHash("sha256").update(sourceText).digest("hex") };
const params = { params: Promise.resolve({ id: "case-1" }) };
const request = (data: unknown = body) => new Request("http://localhost/api/support/case-1/reply-draft", { method: "POST",
  headers: { "content-type": "application/json" }, body: JSON.stringify(data) });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.coarse.mockReturnValue(null);
  mocks.session.mockResolvedValue({ ok: true, ...scope });
  mocks.context.mockResolvedValue({ ok: true, context: scope });
  mocks.transaction.mockImplementation(async (_ctx, fn) => fn({ supportCase: { findFirst: mocks.findCase } }));
  mocks.findCase.mockResolvedValue({ id: "case-1", revision: 3 });
  mocks.rag.mockResolvedValue({ results: [hit], diagnostics: { degraded: false, searchMode: "semantic" } });
});

describe("POST support reply draft: read-only, scoped evidence", () => {
  it("returns an exact-source draft using only session-derived scope and explicit search input", async () => {
    const response = await POST(request(), params);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ status: "draft", caseRevision: 3, humanReviewRequired: true, customerSendAllowed: false,
      citations: [{ chunkId: "chunk-1", quote: sourceText }] });
    expect(mocks.transaction).toHaveBeenCalledWith(scope, expect.any(Function));
    expect(mocks.findCase).toHaveBeenCalledWith({ where: { id: "case-1", customer: { projectId: "project-1", archivedAt: null } }, select: { id: true, revision: true } });
    expect(mocks.rag).toHaveBeenCalledWith({ query: body.query, product: "HCI", version: "fixture-1", limit: 5 });
    expect(mocks.context).toHaveBeenCalledWith({ userId: "user-1", sessionId: null, tenantId: "tenant-1", companyId: "company-1", projectId: "project-1", product: "portal" }, "apps/web/src/app/api/support/[id]/reply-draft/route.ts");
  });

  it("returns an opaque 404 for a foreign or archived case before retrieval", async () => {
    mocks.findCase.mockResolvedValue(null);
    const response = await POST(request(), params);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
    expect(mocks.rag).not.toHaveBeenCalled();
  });

  it.each(["projectId", "tenantId", "companyId", "role", "approved", "source", "citations"])(
    "refuses client-supplied authority/evidence field %s", async field => {
      const response = await POST(request({ ...body, [field]: "forged" }), params);
      expect(response.status).toBe(422);
      expect(mocks.transaction).not.toHaveBeenCalled();
      expect(mocks.rag).not.toHaveBeenCalled();
    });

  it("requires a persisted session even when direct-call coarse guards pass", async () => {
    mocks.session.mockResolvedValue({ ok: false });
    expect((await POST(request(), params)).status).toBe(401);
    expect(mocks.context).not.toHaveBeenCalled();
    expect(mocks.rag).not.toHaveBeenCalled();
  });

  it("refuses unavailable or insufficient actor assignment", async () => {
    mocks.context.mockRejectedValueOnce(new Error("private database detail"));
    const response = await POST(request(), params);
    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain("private");
    mocks.context.mockResolvedValue({ ok: false, response: Response.json({ error: "forbidden" }, { status: 403 }) });
    expect((await POST(request(), params)).status).toBe(403);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("honors a capability refusal before any case read", async () => {
    mocks.context.mockResolvedValue({ ok: false, response: Response.json({ error: "forbidden" }, { status: 403 }) });
    expect((await POST(request(), params)).status).toBe(403);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it.each(["renewal", "service_letter"])("returns a clarification draft for %s without querying or ingesting private sources", async topic => {
    const response = await POST(request({ ...body, topic }), params);
    expect(await response.json()).toMatchObject({ status: "needs_evidence", customerSendAllowed: false, citations: [], draftText: expect.any(String) });
    expect(mocks.rag).not.toHaveBeenCalled();
  });

  it("does not search or guess a patch version", async () => {
    const response = await POST(request({ ...body, version: undefined }), params);
    expect(await response.json()).toMatchObject({ status: "needs_evidence", citations: [] });
    expect(mocks.rag).not.toHaveBeenCalled();
  });

  it("reports a failed provider without raw errors or an ungrounded proposal", async () => {
    mocks.rag.mockRejectedValue(new Error("https://user:secret@private-host"));
    const response = await POST(request(), params);
    expect(response.status).toBe(502);
    const out = await response.json();
    expect(out).toMatchObject({ status: "service_unavailable", draftText: null, citations: [], customerSendAllowed: false });
    expect(JSON.stringify(out)).not.toMatch(/secret|private-host/);
  });

  it("distinguishes no evidence from provider failure", async () => {
    mocks.rag.mockResolvedValue({ results: [], diagnostics: { degraded: false, searchMode: "bm25" } });
    const response = await POST(request(), params);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "needs_evidence", draftText: null });
  });

  it("rejects invalid JSON before any case read", async () => {
    const bad = new Request("http://localhost/api/support/case-1/reply-draft", { method: "POST", body: "{" });
    expect((await POST(bad, params)).status).toBe(400);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});

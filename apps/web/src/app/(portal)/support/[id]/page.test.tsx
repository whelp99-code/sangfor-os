import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cookie: vi.fn(), session: vi.fn(), context: vi.fn(), transaction: vi.fn(), findCase: vi.fn(),
  replyPanel: vi.fn(), knowledgePanel: vi.fn(),
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: mocks.cookie }) }));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NOT_FOUND"); },
  redirect: (path: string) => { throw new Error(`REDIRECT:${path}`); },
}));
vi.mock("next/link", () => ({ default: ({ children }: { children: string }) => createElement("span", null, children) }));
vi.mock("@sangfor/db", () => ({ withRlsTransaction: mocks.transaction }));
vi.mock("@/lib/auth/persisted-session", () => ({ evaluatePersistedSessionFromRequest: mocks.session }));
vi.mock("@/lib/auth/authorization", () => ({ resolveBusinessCapabilityContext: mocks.context }));
vi.mock("@/components/support/support-reply-draft-panel", () => ({ SupportReplyDraftPanel: mocks.replyPanel }));
vi.mock("@/components/support/related-knowledge-panel", () => ({ RelatedKnowledgePanel: mocks.knowledgePanel }));
vi.mock("@/components/support/support-case-actions", () => ({ SupportCaseActions: () => null }));
vi.mock("@/components/support/support-sla-clock", () => ({ SupportSlaClock: () => null }));

import SupportCaseDetail from "./page";

const scope = { userId: "user-1", tenantId: "tenant-1", companyId: "company-1", projectId: "project-1", businessRole: "support_engineer" };
const params = { params: Promise.resolve({ id: "case-1" }) };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.cookie.mockReturnValue({ value: "synthetic-session" });
  mocks.session.mockResolvedValue({ ok: true, ...scope });
  mocks.context.mockResolvedValue({ ok: true, context: scope });
  mocks.transaction.mockImplementation(async (_context, fn) => fn({ supportCase: { findFirst: mocks.findCase } }));
  mocks.findCase.mockResolvedValue({ id: "case-1", subject: "Synthetic support case", severity: "low", status: "open", revision: 1,
    customer: { name: "Synthetic customer" }, vendorEscalations: [] });
  mocks.replyPanel.mockReturnValue(createElement("div", null, "SYNTHETIC REPLY PANEL"));
  mocks.knowledgePanel.mockReturnValue(createElement("div", null, "SYNTHETIC KNOWLEDGE PANEL"));
});

async function render() { return renderToStaticMarkup(await SupportCaseDetail(params)); }

function expectNoPanelsOrRetrieval() {
  expect(mocks.replyPanel).not.toHaveBeenCalled();
  expect(mocks.knowledgePanel).not.toHaveBeenCalled();
}

describe("support detail page scope before reply controls or evidence", () => {
  it("renders only after the persisted support capability and scoped RLS case read succeed", async () => {
    expect(await render()).toContain("SYNTHETIC REPLY PANEL");
    expect(mocks.cookie).toHaveBeenCalledWith("session");
    expect(mocks.context).toHaveBeenCalledWith({ userId: "user-1", sessionId: null, tenantId: "tenant-1", companyId: "company-1", projectId: "project-1", product: "portal" },
      "apps/web/src/app/api/support/[id]/reply-draft/route.ts");
    expect(mocks.transaction).toHaveBeenCalledWith(scope, expect.any(Function));
    expect(mocks.findCase).toHaveBeenCalledWith({ where: { id: "case-1", customer: { projectId: "project-1", archivedAt: null } },
      include: { customer: { select: { name: true } }, vendorEscalations: true } });
    expect(mocks.replyPanel).toHaveBeenCalledWith(expect.objectContaining({ supportCaseId: "case-1" }), undefined);
  });

  it.each(["foreign", "archived", "missing"])("returns opaque 404 before panels for a %s case", async () => {
    mocks.findCase.mockResolvedValue(null);
    await expect(render()).rejects.toThrow("NOT_FOUND");
    expectNoPanelsOrRetrieval();
  });

  it("redirects missing session cookies before any case or capability lookup", async () => {
    mocks.cookie.mockReturnValue(undefined);
    await expect(render()).rejects.toThrow("REDIRECT:/login");
    expect(mocks.session).not.toHaveBeenCalled();
    expect(mocks.context).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
    expectNoPanelsOrRetrieval();
  });

  it("redirects an invalid persisted session before lookup or rendering", async () => {
    mocks.session.mockResolvedValue({ ok: false });
    await expect(render()).rejects.toThrow("REDIRECT:/login");
    expect(mocks.context).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
    expectNoPanelsOrRetrieval();
  });

  it("fails closed on missing support capability or revoked assignment", async () => {
    mocks.context.mockResolvedValue({ ok: false, response: Response.json({ error: "forbidden" }, { status: 403 }) });
    await expect(render()).rejects.toThrow("NOT_FOUND");
    expect(mocks.transaction).not.toHaveBeenCalled();
    expectNoPanelsOrRetrieval();
  });

  it("fails closed when current authorization cannot be established", async () => {
    mocks.context.mockRejectedValue(new Error("Synthetic authorization outage"));
    await expect(render()).rejects.toThrow("NOT_FOUND");
    expect(mocks.transaction).not.toHaveBeenCalled();
    expectNoPanelsOrRetrieval();
  });
});

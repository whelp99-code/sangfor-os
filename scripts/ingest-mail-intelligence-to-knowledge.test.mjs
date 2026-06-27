import { describe, expect, it } from "vitest";
import {
  buildCandidateRequestBody,
  normalizeSqliteMessageRow,
  selectRawFallbackSource,
} from "./ingest-mail-intelligence-to-knowledge.mjs";

const existingAccounts = "/tmp/accounts.json";
const existingSqlite = "/tmp/data.db";

function fakeExists(path) {
  return path === existingSqlite;
}

describe("real mail ingest fallback helpers", () => {
  it("normalizes a .mail-intel SQLite message row into the raw mail shape", () => {
    expect(
      normalizeSqliteMessageRow({
        id: "msg006",
        subject: "RE: Product demo feedback",
        from_addr: "client@samsung.com",
        from_name: "Choi Client",
        received_at: "2026-06-20T06:00:00Z",
        body_preview: "Great demo! We want to proceed with 200 units. Can you send proposal?",
        category: null,
        urgency: null,
        sentiment: null,
        confidence: null,
        raw_json: null,
      }),
    ).toMatchObject({
      id: "msg006",
      subject: "RE: Product demo feedback",
      from: "client@samsung.com",
      fromName: "Choi Client",
      receivedAt: "2026-06-20T06:00:00Z",
      bodyPreview: "Great demo! We want to proceed with 200 units. Can you send proposal?",
      accountId: "mail-intel-sqlite",
      accountEmail: "client@samsung.com",
      aiEnhanced: false,
    });
  });

  it("selects SQLite fallback when accounts.json is absent and data.db exists", () => {
    expect(
      selectRawFallbackSource({
        accountsPath: existingAccounts,
        sqlitePath: existingSqlite,
        exists: fakeExists,
      }),
    ).toBe("sqlite");
  });

  it("passes legacyKnowledgeFallback to candidate generation for raw fallback", () => {
    expect(
      buildCandidateRequestBody({
        projectSlug: "demo-project",
        limit: 8,
        legacyKnowledgeFallback: true,
      }),
    ).toEqual({
      projectSlug: "demo-project",
      limit: 8,
      legacyKnowledgeFallback: true,
    });
  });
});

import type { AuthContext } from "@sangfor/auth";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  tx: null as Record<string, unknown> | null,
  mailAccountFindFirst: vi.fn(),
  listCustomersWithOpportunities: vi.fn(),
  getOpportunityDetail: vi.fn(),
  appendAuditEvent: vi.fn(),
}));

vi.mock("@sangfor/db", () => ({
  Prisma: {},
  canonicalizeRfc8785: (value: unknown) => JSON.stringify(value),
  prisma: {
    mailAccount: {
      findFirst: harness.mailAccountFindFirst,
    },
  },
  withRlsTransaction: vi.fn(
    async (_ctx: unknown, callback: (tx: unknown) => Promise<unknown>) => {
      if (!harness.tx) throw new Error("test transaction is not configured");
      return callback(harness.tx);
    },
  ),
}));

vi.mock("../../crm/customer-partner", () => {
  class CrmServiceError extends Error {
    constructor(
      readonly code: string,
      readonly status: number,
      message: string,
    ) {
      super(message);
    }
  }
  return {
    CrmServiceError,
    listCustomersWithOpportunities: harness.listCustomersWithOpportunities,
  };
});

vi.mock("../../crm/opportunity-center", () => ({
  getOpportunityDetail: harness.getOpportunityDetail,
}));

vi.mock("../../governance/audit-db", () => ({
  appendAuditEvent: harness.appendAuditEvent,
}));

import { syncCalendarMeetings } from "./outlook-graph";

const SALES: AuthContext = {
  userId: "user-sales",
  sessionId: "session-sales",
  tenantId: "tenant-a",
  companyId: "company-a",
  projectId: "project-a",
  businessRole: "sales_manager",
  permissions: ["customer.read", "opportunity.read", "opportunity.write"],
  product: "portal",
};

function activeRole() {
  return {
    id: "assignment-sales",
    userId: SALES.userId,
    companyId: SALES.companyId,
    role: "sales_manager",
    status: "active",
    validFrom: null,
    expiresAt: null,
    revokedAt: null,
  };
}

function fakeTx() {
  return {
    $executeRaw: vi.fn(async () => 1),
    userCompanyRole: {
      findMany: vi.fn(async () => [activeRole()]),
    },
    projectMember: {
      findFirst: vi.fn(async () => ({
        id: "member-sales",
        userId: SALES.userId,
        projectId: SALES.projectId,
        status: "active",
        validFrom: null,
        expiresAt: null,
        revokedAt: null,
      })),
    },
    auditLog: {
      findFirst: vi.fn(async () => null),
    },
    opportunity: {
      findFirst: vi.fn(async () => ({ id: "opportunity-1" })),
    },
    meetingNote: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async () => ({ id: "meeting-1" })),
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  harness.tx = fakeTx();
  harness.mailAccountFindFirst.mockResolvedValue({
    id: "mail-account-1",
    projectId: SALES.projectId,
    provider: "outlook",
    accessToken: "access-token",
    refreshToken: "refresh-token",
    tokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
    tokenScope: "Mail.Read Calendars.Read",
  });
  harness.listCustomersWithOpportunities.mockResolvedValue({
    items: [
      {
        id: "customer-1",
        opportunities: [{ id: "opportunity-1" }],
      },
    ],
    pageInfo: { hasNextPage: false, endCursor: null },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({
        value: [
          {
            id: "graph-event-1",
            subject: "Acme discovery",
            bodyPreview: "Discussed scoped opportunity.",
            start: { dateTime: "2026-07-24T01:00:00.000Z" },
            organizer: {
              emailAddress: { address: "Buyer@ACME.CO.KR", name: "Buyer" },
            },
            attendees: [],
          },
        ],
      }),
    })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Outlook calendar Customer read adapter", () => {
  it("matches a normalized domain through the canonical scoped customer page", async () => {
    const result = await syncCalendarMeetings(SALES, {
      daysBack: 1,
      daysAhead: 1,
      idempotencyKey: "calendar-sync-1",
    });

    expect(result).toEqual({ fetched: 1, created: 1, matched: 1 });
    expect(harness.mailAccountFindFirst).toHaveBeenCalledWith({
      where: {
        projectId: SALES.projectId,
        provider: "outlook",
        refreshToken: { not: null },
      },
    });
    expect(harness.listCustomersWithOpportunities).toHaveBeenCalledWith(SALES, {
      domain: "acme.co.kr",
      first: 1,
    });
    expect(
      (harness.tx as ReturnType<typeof fakeTx>).opportunity.findFirst,
    ).toHaveBeenCalledWith({
      where: {
        id: "opportunity-1",
        projectId: SALES.projectId,
        archivedAt: null,
      },
      select: { id: true },
    });
    expect(harness.appendAuditEvent).toHaveBeenCalledWith(
      harness.tx,
      expect.objectContaining({
        eventType: "meeting_note.calendar_synced",
      }),
    );
  });

  it("rejects caller-selected scope before mailbox or Graph access", async () => {
    await expect(
      syncCalendarMeetings(SALES, {
        daysBack: 1,
        daysAhead: 1,
        idempotencyKey: "calendar-sync-scope",
        projectId: "attacker-project",
      } as never),
    ).rejects.toThrow();

    expect(harness.mailAccountFindFirst).not.toHaveBeenCalled();
  });

  it("contains no direct Customer delegate or default-project lookup", () => {
    const source = readFileSync(
      fileURLToPath(new URL("./outlook-graph.ts", import.meta.url)),
      "utf8",
    );

    expect(source).not.toMatch(/\bprisma\.customer\b/);
    expect(source).not.toMatch(/\btx\.customer\b/);
    expect(source).not.toMatch(
      /resolveProjectId|resolveDefaultProjectId|resolveDefaultProjectSlug/,
    );
    expect(source).toContain(
      "listCustomersWithOpportunities(ctx, { domain, first: 1 })",
    );
  });
});

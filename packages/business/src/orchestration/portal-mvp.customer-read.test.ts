import type { AuthContext } from "@sangfor/auth";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  listCustomersWithOpportunities: vi.fn(),
}));

vi.mock("@sangfor/db", () => ({
  withRlsTransaction: vi.fn(),
}));

vi.mock("../crm/customer-partner", () => ({
  listCustomersWithOpportunities: harness.listCustomersWithOpportunities,
}));

import {
  connectMockOutlook,
  syncMockMail,
  syncMockMailSchema,
} from "./portal-mvp";

const SALES: AuthContext = {
  userId: "user-sales",
  sessionId: "session-sales",
  tenantId: "tenant-a",
  companyId: "company-a",
  projectId: "project-a",
  businessRole: "sales_manager",
  permissions: ["customer.read", "opportunity.read"],
  product: "portal",
};

beforeEach(() => {
  vi.clearAllMocks();
  harness.listCustomersWithOpportunities.mockResolvedValue({
    items: [
      {
        id: "customer-1",
        opportunities: [{ id: "opportunity-1" }],
      },
    ],
    pageInfo: { hasNextPage: false, endCursor: null },
  });
});

describe("portal MVP Customer read adapter", () => {
  it("matches each normalized mail domain through the canonical scoped service", async () => {
    const result = await syncMockMail(SALES, {
      expectedAccountUpdatedAt: "2026-07-24T00:00:00.000Z",
      idempotencyKey: "portal-sync-1",
    });

    expect(result.status).toBe("review_required");
    expect(result.drafts).toHaveLength(3);
    expect(result.drafts.every((draft) => draft.customerId === "customer-1")).toBe(
      true,
    );
    expect(harness.listCustomersWithOpportunities).toHaveBeenCalledTimes(3);
    expect(
      harness.listCustomersWithOpportunities.mock.calls.every(
        ([ctx, query]) =>
          ctx === SALES && query.domain === "example.com" && query.first === 1,
      ),
    ).toBe(true);
  });

  it("rejects caller-selected scope and does not synthesize a mail account", async () => {
    expect(
      syncMockMailSchema.safeParse({
        expectedAccountUpdatedAt: "2026-07-24T00:00:00.000Z",
        idempotencyKey: "portal-sync-scope",
        projectId: "attacker-project",
      }).success,
    ).toBe(false);

    const result = await connectMockOutlook(SALES, {
      idempotencyKey: "portal-connect-1",
    });
    expect(result).toEqual({
      status: "review_required",
      reason: "authenticated_mail_account_command_required",
      idempotencyKey: "portal-connect-1",
      authenticatedApiPath: "/api/portal",
    });
    expect(harness.listCustomersWithOpportunities).not.toHaveBeenCalled();
  });

  it("contains no direct Customer read, default project, or entity write", () => {
    const source = readFileSync(
      fileURLToPath(new URL("./portal-mvp.ts", import.meta.url)),
      "utf8",
    );

    expect(source).not.toMatch(/\b(?:prisma|tx)\.customer\b/);
    expect(source).not.toMatch(
      /resolveProjectId|resolveDefaultProjectId|resolveDefaultProjectSlug/,
    );
    expect(source).not.toMatch(
      /\.(?:mailAccount|mailMessage|workTask)\.(?:create|update|upsert|delete)/,
    );
    expect(source).toContain(
      "listCustomersWithOpportunities(ctx, { domain, first: 1 })",
    );
  });
});

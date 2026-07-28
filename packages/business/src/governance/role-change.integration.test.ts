import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// @ts-expect-error U009 lifecycle is committed JavaScript without declarations.
import { withIsolatedPostgres } from "../../../../scripts/lib/isolated-postgres.mjs";

import { createRoleChangeRequest, decideRoleChange } from "./role-change";

const integration = process.env.CI_INTEGRATION === "1";
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../../..");
const IMAGE_DIGEST = "sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777";

let client: PrismaClient;
let release: (() => void) | undefined;
let lifecycle: Promise<void> | undefined;

const scope = { tenantId: "u024-tenant", companyId: "u024-company", projectId: "u024-project" };
function actor(userId: string, sessionId: string, mfaVerifiedAt: Date | null = new Date()) {
  return { userId, sessionId, scope, mfaVerifiedAt };
}

describe.skipIf(!integration)("role-change integration (U009 isolated Postgres)", () => {
  beforeAll(async () => {
    let ready!: (url: string) => void;
    const databaseUrl = new Promise<string>((resolveReady) => { ready = resolveReady; });
    let hold!: () => void;
    const held = new Promise<void>((resolveHeld) => { hold = resolveHeld; });
    lifecycle = withIsolatedPostgres({ runId: `u024it-${Date.now().toString(36)}`, ownerUnit: "U024", purpose: "role-change-integration", evidenceDir: join(ROOT, "tmp/u024-integration-evidence"), imageDigest: IMAGE_DIGEST, migrate: true }, async (ctx: { databaseUrl: string }) => { ready(ctx.databaseUrl); await held; });
    release = hold;
    client = new PrismaClient({ datasources: { db: { url: await databaseUrl } } });

    await client.tenant.create({ data: { id: scope.tenantId, name: "U024 Tenant", slug: scope.tenantId, status: "active" } });
    await client.company.create({ data: { id: scope.companyId, tenantId: scope.tenantId, name: "U024 Company", slug: scope.companyId } });
    await client.project.create({ data: { id: scope.projectId, companyId: scope.companyId, name: "U024 Project", slug: scope.projectId } });
    for (const id of ["requester", "target", "approver-a", "approver-b"]) {
      await client.user.create({ data: { id, email: `${id}@u024.integration.example.com`, name: id } });
    }
    await client.userCompanyRole.createMany({ data: [
      { id: "assignment-requester", userId: "requester", companyId: scope.companyId, role: "security_officer", status: "active" },
      { id: "assignment-target", userId: "target", companyId: scope.companyId, role: "account_manager", status: "active" },
      { id: "assignment-approver-a", userId: "approver-a", companyId: scope.companyId, role: "security_officer", status: "active" },
      { id: "assignment-approver-b", userId: "approver-b", companyId: scope.companyId, role: "security_officer", status: "active" },
    ] });
  }, 180_000);

  afterAll(async () => {
    await client?.$disconnect();
    release?.();
    await lifecycle;
  }, 60_000);

  it("keeps pending@0 after one MFA approver and applies exactly once after a distinct second MFA approver", async () => {
    const created = await client.$transaction((tx) => createRoleChangeRequest({ targetMembershipId: "assignment-target", toRole: "security_officer", reason: "segregate privileged review", expectedMembershipRevision: 0, idempotencyKey: "u024-integration-key-0001" }, actor("requester", "requester-session"), tx));
    expect(created.request.status).toBe("pending_approval");
    expect(created.request.revision).toBe(0);

    const first = await client.$transaction((tx) => decideRoleChange({ roleChangeRequestId: created.request.id, approvalId: created.request.approvalRequestId!, decision: "approve", expectedRevision: 1 }, actor("approver-a", "approver-a-session"), tx));
    expect(first.outcome).toBe("recorded_nonterminal");
    await expect(client.roleChangeRequest.findUniqueOrThrow({ where: { id: created.request.id } })).resolves.toMatchObject({ status: "pending_approval", revision: 0 });
    await expect(client.userCompanyRole.findUniqueOrThrow({ where: { id: "assignment-target" } })).resolves.toMatchObject({ role: "account_manager", revision: 0 });

    const final = await client.$transaction((tx) => decideRoleChange({ roleChangeRequestId: created.request.id, approvalId: created.request.approvalRequestId!, decision: "approve", expectedRevision: 2 }, actor("approver-b", "approver-b-session"), tx));
    expect(final.request).toMatchObject({ status: "applied", revision: 1, appliedMembershipRevision: 1, appliedDecisionSequence: 2 });
    await expect(client.userCompanyRole.findUniqueOrThrow({ where: { id: "assignment-target" } })).resolves.toMatchObject({ role: "security_officer", revision: 1 });
  }, 120_000);
});

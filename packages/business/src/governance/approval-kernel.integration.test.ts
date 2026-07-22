import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

import { PrismaClient, type Prisma } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseCanonicalArtifactContent } from "@sangfor/db";

// @ts-expect-error -- U009's committed reuse module is plain JS, no .d.ts.
import { withIsolatedPostgres } from "../../../../scripts/lib/isolated-postgres.mjs";

import {
  cancelApprovalRequest,
  decideApprovalWithClient,
  expireIfDue,
  markValidityStale,
  submitApprovalRequest,
  type ApprovalKernelCaller,
  type CreateApprovalRequestInput,
  type DecideApprovalResult,
} from "./approval-kernel";

const integration = process.env.CI_INTEGRATION === "1";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../../..");
const IMAGE_DIGEST = "sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777";
const RUN_ID = `u022it${Date.now().toString(36)}`;
const EVIDENCE_DIR = join(REPO_ROOT, "tmp/u022-integration-evidence");

const TENANT = "u022-tenant-1";
const COMPANY = "u022-company-1";
const OTHER_COMPANY = "u022-company-2";
const PROJECT = "u022-project-1";
const OTHER_PROJECT = "u022-project-2";

let prisma: PrismaClient | null = null;
let cleanupFn: (() => Promise<void>) | null = null;
let artifactVersionId: string;
let artifactHash: string;

function db(): PrismaClient {
  return prisma as PrismaClient;
}

// Every kernel call below goes through the test's OWN dedicated PrismaClient (bound to the
// isolated scratch database) via the kernel's tx-accepting entrypoints
// (`submitApprovalRequest(..., tx)` / `decideApprovalWithClient(tx, ...)` /
// `expireIfDue(id, tx)` / `cancelApprovalRequest(id, rev, reason, tx)` /
// `markValidityStale(id, reason, tx)`) — never the shared `@sangfor/db` singleton, which this
// test never touches or reconfigures.

function caller(overrides: Partial<ApprovalKernelCaller> = {}): ApprovalKernelCaller {
  return {
    userId: "u022-user-requester",
    sessionId: "sess-requester",
    scope: { tenantId: TENANT, companyId: COMPANY, projectId: PROJECT },
    mfaVerifiedAt: new Date(),
    ...overrides,
  };
}

// U018 enforces a partial unique index on (artifactVersionId, action, policyHash) for OPEN
// requests. Several scenarios below deliberately leave a request open (ready_for_human_approval)
// for the rest of the test, so each call gets its own `action` — a distinct policyHash — rather
// than colliding with a still-open request from an earlier test.
let actionCounter = 0;
function createInput(overrides: Partial<CreateApprovalRequestInput> = {}): CreateApprovalRequestInput {
  return {
    action: `release-${++actionCounter}`,
    artifactVersionId,
    artifactHash,
    policyVersion: "v1",
    requiredQuorum: 2,
    ...overrides,
  };
}

async function createReady(overrides: Partial<CreateApprovalRequestInput> = {}, requester = caller()) {
  return db().$transaction((tx) => submitApprovalRequest(createInput(overrides), requester, tx));
}

async function decide(input: { approvalId: string; decision: string; expectedRevision: number; reason?: string }, requester: ApprovalKernelCaller): Promise<DecideApprovalResult> {
  return db().$transaction((tx) => decideApprovalWithClient(tx, input, requester));
}

describe.skipIf(!integration)("approval-kernel (integration, requires Docker + CI_INTEGRATION=1)", () => {
  beforeAll(async () => {
    let resolveReady: (databaseUrl: string) => void;
    const ready = new Promise<string>((r) => (resolveReady = r));
    let releaseCallback: (() => void) | null = null;
    const held = new Promise<void>((r) => (releaseCallback = r));

    const lifecycle = withIsolatedPostgres(
      { runId: RUN_ID, ownerUnit: "U022", purpose: "approval-kernel-integration", evidenceDir: EVIDENCE_DIR, imageDigest: IMAGE_DIGEST, migrate: true },
      async (ctx: { databaseUrl: string }) => {
        resolveReady(ctx.databaseUrl);
        await held;
      },
    );
    cleanupFn = async () => {
      releaseCallback?.();
      await lifecycle;
    };

    const databaseUrl = await ready;
    prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

    const client = db();
    await client.tenant.create({ data: { id: TENANT, name: "U022 Tenant", slug: TENANT, status: "active" } });
    await client.company.create({ data: { id: COMPANY, tenantId: TENANT, name: "U022 Company", slug: COMPANY } });
    await client.company.create({ data: { id: OTHER_COMPANY, tenantId: TENANT, name: "U022 Other Company", slug: OTHER_COMPANY } });
    await client.project.create({ data: { id: PROJECT, slug: PROJECT, name: "U022 Project", companyId: COMPANY } });
    await client.project.create({ data: { id: OTHER_PROJECT, slug: OTHER_PROJECT, name: "U022 Other Project", companyId: OTHER_COMPANY } });

    const users = ["requester", "approver1", "approver2", "approver3", "cross", "inactive"];
    for (const u of users) {
      await client.user.create({ data: { id: `u022-user-${u}`, email: `${u}@u022.fixture.example.com`, name: u } });
    }
    await client.userCompanyRole.create({ data: { id: "u022-ucr-requester", userId: "u022-user-requester", companyId: COMPANY, role: "account_manager", status: "active" } });
    await client.userCompanyRole.create({ data: { id: "u022-ucr-approver1", userId: "u022-user-approver1", companyId: COMPANY, role: "account_manager", status: "active" } });
    await client.userCompanyRole.create({ data: { id: "u022-ucr-approver2", userId: "u022-user-approver2", companyId: COMPANY, role: "account_manager", status: "active" } });
    await client.userCompanyRole.create({ data: { id: "u022-ucr-approver3", userId: "u022-user-approver3", companyId: COMPANY, role: "account_manager", status: "active" } });
    await client.userCompanyRole.create({ data: { id: "u022-ucr-cross", userId: "u022-user-cross", companyId: OTHER_COMPANY, role: "account_manager", status: "active" } });
    await client.userCompanyRole.create({
      data: { id: "u022-ucr-inactive", userId: "u022-user-inactive", companyId: COMPANY, role: "account_manager", status: "revoked", revokedAt: new Date() },
    });

    const artifact = await client.artifact.create({
      data: {
        id: "u022-artifact-1",
        tenantId: TENANT,
        companyId: COMPANY,
        projectId: PROJECT,
        artifactType: "proposal",
        classification: "internal",
        origin: "human",
        title: "U022 Integration Artifact",
        createdByAssignmentId: "u022-ucr-requester",
        ownerAssignmentId: "u022-ucr-requester",
      },
    });
    const content = parseCanonicalArtifactContent(JSON.stringify({ title: "u022 integration release", body: "v1" }));
    const version = await client.artifactVersion.create({
      data: {
        id: "u022-artv-1",
        artifactId: artifact.id,
        version: 1,
        contentHashVersion: content.contentHashVersion,
        canonicalContentEnvelope: content.canonicalContentEnvelope,
        contentHash: content.contentHash,
        contentJson: content.contentJson as Prisma.InputJsonValue,
        status: "review_ready",
        createdByAssignmentId: "u022-ucr-requester",
      },
    });
    artifactVersionId = version.id;
    artifactHash = version.contentHash;
  }, 180_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    await cleanupFn?.();
  }, 60_000);

  it("creates pending@0, CASes to ready_for_human_approval@1, and the validity projection matches every snapshot field", async () => {
    const { request, validity } = await createReady();
    expect(request.status).toBe("ready_for_human_approval");
    expect(request.revision).toBe(1);
    expect(request.legacyUnbound).toBe(false);
    expect(request.validationSnapshotHash).toMatch(/^[0-9a-f]{64}$/);

    expect(validity.approvalRequestId).toBe(request.id);
    expect(validity.requestRevision).toBe(1);
    expect(validity.artifactVersionId).toBe(artifactVersionId);
    expect(validity.artifactHashSnapshot).toBe(artifactHash);
    expect(validity.policyHashSnapshot).toBe(request.policyHash);
    expect(validity.requiredQuorum).toBe(2);
    expect(validity.satisfiedQuorum).toBe(0);
    expect(validity.lastDecisionSequence).toBe(0);
    expect(validity.state).toBe("pending");
  });

  it("resulting-revision consistency: ApprovalRequest.revision == ApprovalDecision.requestRevision == ApprovalCurrentValidity.requestRevision at every step", async () => {
    const { request } = await createReady({ requiredQuorum: 2 });

    const first = await decide({ approvalId: request.id, decision: "approve", expectedRevision: 1 }, caller({ userId: "u022-user-approver1", sessionId: "s1" }));
    expect(first.outcome).toBe("recorded_nonterminal");
    expect(first.request.revision).toBe(2);
    expect(first.decision.requestRevision).toBe(2);
    expect(first.validity.requestRevision).toBe(2);

    const final = await decide({ approvalId: request.id, decision: "approve", expectedRevision: 2 }, caller({ userId: "u022-user-approver2", sessionId: "s2" }));
    expect(final.outcome).toBe("approved");
    expect(final.request.revision).toBe(3);
    expect(final.decision.requestRevision).toBe(3);
    expect(final.validity.requestRevision).toBe(3);

    const persistedRequest = await db().approvalRequest.findUniqueOrThrow({ where: { id: request.id } });
    const persistedValidity = await db().approvalCurrentValidity.findUniqueOrThrow({ where: { approvalRequestId: request.id } });
    const persistedDecisions = await db().approvalDecision.findMany({ where: { approvalRequestId: request.id }, orderBy: { sequence: "asc" } });

    expect(persistedRequest.revision).toBe(3);
    expect(persistedValidity.requestRevision).toBe(3);
    expect(persistedDecisions.map((d) => d.requestRevision)).toEqual([2, 3]);
    expect(persistedDecisions.map((d) => d.sequence)).toEqual([1, 2]);
  });

  it("under-quorum approve is explicitly nonterminal and the projection stays pending", async () => {
    const { request } = await createReady({ requiredQuorum: 3 });
    const result = await decide({ approvalId: request.id, decision: "approve", expectedRevision: 1 }, caller({ userId: "u022-user-approver1", sessionId: "s1" }));
    expect(result.outcome).toBe("recorded_nonterminal");
    expect(result.request.status).toBe("ready_for_human_approval");
    expect(result.validity.state).toBe("pending");
    expect(result.validity.satisfiedQuorum).toBe(1);
  });

  it("exactly one winner under concurrent final-quorum decisions; the loser gets a stable conflict", async () => {
    const { request } = await createReady({ requiredQuorum: 2 });
    await decide({ approvalId: request.id, decision: "approve", expectedRevision: 1 }, caller({ userId: "u022-user-approver1", sessionId: "s1" }));

    const settled = await Promise.allSettled([
      decide({ approvalId: request.id, decision: "approve", expectedRevision: 2 }, caller({ userId: "u022-user-approver2", sessionId: "s2" })),
      decide({ approvalId: request.id, decision: "approve", expectedRevision: 2 }, caller({ userId: "u022-user-approver3", sessionId: "s3" })),
    ]);

    const fulfilled = settled.filter((s) => s.status === "fulfilled") as PromiseFulfilledResult<DecideApprovalResult>[];
    const rejected = settled.filter((s) => s.status === "rejected") as PromiseRejectedResult[];
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(fulfilled[0]!.value.outcome).toBe("approved");
    expect(rejected[0]!.reason).toMatchObject({ code: "STALE_REVISION" });

    const persistedRequest = await db().approvalRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(persistedRequest.status).toBe("approved");
    expect(persistedRequest.revision).toBe(3);

    const validCount = await db().approvalCurrentValidity.count({ where: { approvalRequestId: request.id, state: "valid" } });
    expect(validCount).toBe(1);
    const decisions = await db().approvalDecision.count({ where: { approvalRequestId: request.id } });
    expect(decisions).toBe(2); // approver1's under-quorum approve + exactly one of approver2/approver3's final approve
  });

  it("terminal cannot reopen even with the latest revision", async () => {
    const { request } = await createReady({ requiredQuorum: 1 });
    const approved = await decide({ approvalId: request.id, decision: "approve", expectedRevision: 1 }, caller({ userId: "u022-user-approver1", sessionId: "s1" }));
    expect(approved.request.status).toBe("approved");

    await expect(
      decide({ approvalId: request.id, decision: "approve", expectedRevision: approved.request.revision }, caller({ userId: "u022-user-approver2", sessionId: "s2" })),
    ).rejects.toMatchObject({ code: "TERMINAL_STATE" });
  });

  it("rejects a duplicate approver even under the U018 unique (approvalRequestId, actorAssignmentId) constraint", async () => {
    const { request } = await createReady({ requiredQuorum: 3 });
    await decide({ approvalId: request.id, decision: "approve", expectedRevision: 1 }, caller({ userId: "u022-user-approver1", sessionId: "s1" }));
    await expect(
      decide({ approvalId: request.id, decision: "reject", expectedRevision: 2 }, caller({ userId: "u022-user-approver1", sessionId: "s1b" })),
    ).rejects.toMatchObject({ code: "DUPLICATE_APPROVER" });
  });

  it("fails closed: stale revision, foreign company (opaque 404), inactive role, missing MFA", async () => {
    const { request } = await createReady({ requiredQuorum: 2 });

    await expect(
      decide({ approvalId: request.id, decision: "approve", expectedRevision: 0 }, caller({ userId: "u022-user-approver1", sessionId: "s1" })),
    ).rejects.toMatchObject({ code: "STALE_REVISION" });

    await expect(
      decide(
        { approvalId: request.id, decision: "approve", expectedRevision: 1 },
        caller({ userId: "u022-user-cross", sessionId: "sc", scope: { tenantId: TENANT, companyId: OTHER_COMPANY, projectId: OTHER_PROJECT } }),
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    await expect(
      decide({ approvalId: request.id, decision: "approve", expectedRevision: 1 }, caller({ userId: "u022-user-inactive", sessionId: "si" })),
    ).rejects.toMatchObject({ code: "INACTIVE_ROLE" });

    await expect(
      decide({ approvalId: request.id, decision: "approve", expectedRevision: 1 }, caller({ userId: "u022-user-approver1", sessionId: "s1", mfaVerifiedAt: null })),
    ).rejects.toMatchObject({ code: "MFA_REQUIRED" });
  });

  it("audit failure rolls back the entire decision — no request/decision/projection partial commit", async () => {
    const { request } = await createReady({ requiredQuorum: 1 });
    const before = await db().approvalRequest.findUniqueOrThrow({ where: { id: request.id } });
    const beforeDecisions = await db().approvalDecision.count({ where: { approvalRequestId: request.id } });
    const beforeAudit = await db().auditLog.count({ where: { resourceId: request.id } });

    await expect(
      decide(
        { approvalId: request.id, decision: "approve", expectedRevision: 1 },
        // A projectId that does not exist under this company breaks the audit_logs composite FK
        // (companyId, projectId) -> projects, forcing appendAuditEvent's insert to fail AFTER the
        // CAS/decision/validity writes already ran earlier in the SAME transaction.
        caller({ userId: "u022-user-approver1", sessionId: "s1", scope: { tenantId: TENANT, companyId: COMPANY, projectId: "does-not-exist" } }),
      ),
    ).rejects.toThrow();

    const after = await db().approvalRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(after.revision).toBe(before.revision);
    expect(after.status).toBe(before.status);
    const afterDecisions = await db().approvalDecision.count({ where: { approvalRequestId: request.id } });
    expect(afterDecisions).toBe(beforeDecisions);
    const afterAudit = await db().auditLog.count({ where: { resourceId: request.id } });
    expect(afterAudit).toBe(beforeAudit);
  });

  it("old decisions remain queryable while the projection becomes terminal stale — history is never deleted", async () => {
    const { request } = await createReady({ requiredQuorum: 1 });
    await decide({ approvalId: request.id, decision: "approve", expectedRevision: 1 }, caller({ userId: "u022-user-approver1", sessionId: "s1" }));

    const beforeDecisionCount = await db().approvalDecision.count({ where: { approvalRequestId: request.id } });

    const stale = await db().$transaction((tx) => markValidityStale(request.id, "superseded_by_new_version", tx));
    expect(stale.state).toBe("stale");

    const afterDecisionCount = await db().approvalDecision.count({ where: { approvalRequestId: request.id } });
    expect(afterDecisionCount).toBe(beforeDecisionCount);
    const stillQueryable = await db().approvalDecision.findMany({ where: { approvalRequestId: request.id } });
    expect(stillQueryable.length).toBeGreaterThan(0);

    // A stale projection can never resurrect to valid.
    await expect(db().$transaction((tx) => markValidityStale(request.id, "again", tx))).rejects.toMatchObject({ code: "ILLEGAL_TRANSITION" });
  });

  it("expireIfDue and cancelApprovalRequest are distinct from a decision — neither ever appends an ApprovalDecision", async () => {
    const { request: r1 } = await createReady({ requiredQuorum: 2 });
    await db().approvalRequest.update({ where: { id: r1.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const expired = await db().$transaction((tx) => expireIfDue(r1.id, tx));
    expect(expired.status).toBe("expired");
    expect(await db().approvalDecision.count({ where: { approvalRequestId: r1.id } })).toBe(0);

    const { request: r2 } = await createReady({ requiredQuorum: 2 });
    const cancelled = await db().$transaction((tx) => cancelApprovalRequest(r2.id, 1, undefined, tx));
    expect(cancelled.status).toBe("cancelled");
    expect(await db().approvalDecision.count({ where: { approvalRequestId: r2.id } })).toBe(0);
  });
});

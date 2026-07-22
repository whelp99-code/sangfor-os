import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// @ts-expect-error U009 lifecycle helper is intentionally JavaScript.
import { withIsolatedPostgres } from "../../../../scripts/lib/isolated-postgres.mjs";

import type { ApprovalKernelCaller } from "../governance/approval-kernel";

const integration = process.env.CI_INTEGRATION === "1";
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../../..");
const IMAGE_DIGEST = "sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777";
const RUN_ID = `u025it${Date.now().toString(36)}`;
const EVIDENCE_DIR = join(REPO_ROOT, ".omo/evidence/sangfor-system-refactor-2026-07-15/U025/attempt-1/integration-lifecycle");
const scope = { tenantId: "u025-tenant", companyId: "u025-company", projectId: "u025-project" };

let fixture: PrismaClient;
let sharedDb: { $disconnect(): Promise<void>; artifact: any; artifactVersion: any; workflowRun: any; workflowRunStep: any; workflowRunEvent: any; auditLog: any; $executeRawUnsafe(sql: string): Promise<unknown> };
let cleanup: (() => Promise<void>) | undefined;
let originalDatabaseUrl: string | undefined;
let artifactVersionId: string;
let workflowDefinitionId: string;
let startWorkflowRun: any;
let transitionWorkflowRun: any;
let transitionWorkflowStep: any;
let getWorkflowRun: any;
let createWorkflowDefinition: any;
let activateWorkflowDefinition: any;
let submitApprovalRequest: any;
let decideApproval: any;
let createArtifactVersion: any;

function caller(overrides: Partial<ApprovalKernelCaller> = {}): ApprovalKernelCaller {
  return { userId: "u025-requester", sessionId: "u025-session", scope, mfaVerifiedAt: new Date(), ...overrides };
}

async function approve(action: string, approvalArtifactVersionId = artifactVersionId) {
  const version = await sharedDb.artifactVersion.findUniqueOrThrow({ where: { id: approvalArtifactVersionId } });
  const request = await submitApprovalRequest({ action, artifactVersionId: version.id, artifactHash: version.contentHash, policyVersion: "v1", requiredQuorum: 1 }, caller());
  return decideApproval(
    { approvalId: request.request.id, decision: "approve", expectedRevision: request.request.revision },
    caller({ userId: "u025-approver", sessionId: "u025-approver-session" }),
  );
}

describe.skipIf(!integration)("U025 canonical persisted workflow runtime (U009 isolated PostgreSQL)", () => {
  beforeAll(async () => {
    let ready!: (databaseUrl: string) => void;
    const databaseReady = new Promise<string>((done) => { ready = done; });
    let release!: () => void;
    const held = new Promise<void>((done) => { release = done; });
    const lifecycle = withIsolatedPostgres(
      { runId: RUN_ID, ownerUnit: "U025", purpose: "canonical-workflow-runtime", evidenceDir: EVIDENCE_DIR, imageDigest: IMAGE_DIGEST, migrate: true },
      async (ctx: { databaseUrl: string }) => { ready(ctx.databaseUrl); await held; },
    );
    cleanup = async () => { release(); await lifecycle; };
    const databaseUrl = await databaseReady;
    originalDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = databaseUrl;

    // Import the canonical runtime only AFTER DATABASE_URL is task-owned, so its singleton is
    // isolated too. The read-after-restart assertion below uses a second, independent client.
    const db = await import("@sangfor/db");
    sharedDb = db.prisma as unknown as typeof sharedDb;
    ({ createArtifactVersion } = await import("../governance/artifact-service"));
    ({ submitApprovalRequest, decideApproval } = await import("../governance/approval-kernel"));
    ({ createWorkflowDefinition, activateWorkflowDefinition } = await import("./workflow-definitions"));
    ({ startWorkflowRun, transitionWorkflowRun, transitionWorkflowStep, getWorkflowRun } = await import("./workflow-runtime"));
    fixture = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

    await fixture.tenant.create({ data: { id: scope.tenantId, name: "U025 tenant", slug: scope.tenantId, status: "active" } });
    await fixture.company.create({ data: { id: scope.companyId, tenantId: scope.tenantId, name: "U025 company", slug: scope.companyId } });
    await fixture.project.create({ data: { id: scope.projectId, companyId: scope.companyId, name: "U025 project", slug: scope.projectId } });
    await fixture.user.create({ data: { id: "u025-requester", email: "requester@u025.test", name: "Requester" } });
    await fixture.user.create({ data: { id: "u025-approver", email: "approver@u025.test", name: "Approver" } });
    await fixture.userCompanyRole.create({ data: { id: "u025-requester-role", userId: "u025-requester", companyId: scope.companyId, role: "security_officer", status: "active" } });
    await fixture.userCompanyRole.create({ data: { id: "u025-approver-role", userId: "u025-approver", companyId: scope.companyId, role: "security_officer", status: "active" } });
    await sharedDb.artifact.create({ data: { id: "u025-definition-artifact", ...scope, artifactType: "workflow-definition", classification: "internal", origin: "human", title: "U025 Definition", createdByAssignmentId: "u025-requester-role", ownerAssignmentId: "u025-requester-role" } });

    const version = await createArtifactVersion({ artifactId: "u025-definition-artifact", expectedCurrentVersionId: null, expectedCurrentRevision: 0, content: '{"runApprovalRequired":false,"steps":[{"key":"collect"},{"key":"review"}]}' , contentType: "application/json" }, caller());
    artifactVersionId = version.versionId;
  }, 180_000);

  afterAll(async () => {
    await sharedDb?.$disconnect();
    await fixture?.$disconnect();
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
    await cleanup?.();
  }, 60_000);

  it("rejects activation without a current exact workflow.activate approval", async () => {
    const draft = await createWorkflowDefinition({ workflowKey: "blocked-activation", name: "Blocked", definitionArtifactVersionId: artifactVersionId }, caller());
    await expect(activateWorkflowDefinition({ workflowDefinitionId: draft.id, expectedRevision: draft.revision, approvalId: "does-not-exist" }, caller())).rejects.toMatchObject({ code: "APPROVAL_REQUIRED" });
  });

  it("activates an exact U017/U023 artifact snapshot and resolves 20 identical concurrent starts to one persisted run", async () => {
    const definition = await createWorkflowDefinition({ workflowKey: "canonical-runtime", name: "Canonical Runtime", definitionArtifactVersionId: artifactVersionId }, caller());
    const approval = await approve("workflow.activate");
    const active = await activateWorkflowDefinition({ workflowDefinitionId: definition.id, expectedRevision: definition.revision, approvalId: approval.request.id }, caller());
    expect(active).toMatchObject({ status: "active", revision: 1, definitionArtifactVersionId: artifactVersionId, activationApprovalRequestId: approval.request.id });
    workflowDefinitionId = active.id;

    const starts = await Promise.all(Array.from({ length: 20 }, () => startWorkflowRun({ workflowDefinitionId, idempotencyKey: "same-payload", input: { b: 2, a: 1 } }, caller())));
    expect(new Set(starts.map((run: { id: string }) => run.id)).size).toBe(1);
    const run = starts[0]!;
    expect(run.steps.map((step: { stepKey: string }) => step.stepKey)).toEqual(["collect", "review"]);
    expect(run.events.map((event: { sequence: number }) => event.sequence)).toEqual([1]);
    await expect(startWorkflowRun({ workflowDefinitionId, idempotencyKey: "same-payload", input: { a: 9 } }, caller())).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  }, 60_000);

  it("persists restart-readable snapshots, enforces every aggregate/CAS transition, and writes contiguous append-only events", async () => {
    const run = await startWorkflowRun({ workflowDefinitionId, idempotencyKey: "state-machine", input: { task: "state" } }, caller());
    await expect(transitionWorkflowRun({ workflowRunId: run.id, expectedRevision: 0, status: "succeeded" }, caller())).rejects.toMatchObject({ code: "ILLEGAL_TRANSITION" });
    const running = await transitionWorkflowRun({ workflowRunId: run.id, expectedRevision: 0, status: "running" }, caller());
    const [first, second] = running.steps;
    await transitionWorkflowStep({ workflowRunStepId: first.id, expectedRevision: 0, status: "running" }, caller());
    await transitionWorkflowStep({ workflowRunStepId: first.id, expectedRevision: 1, status: "succeeded", output: { ok: true } }, caller());
    await transitionWorkflowStep({ workflowRunStepId: second.id, expectedRevision: 0, status: "skipped" }, caller());
    const completed = await transitionWorkflowRun({ workflowRunId: run.id, expectedRevision: 1, status: "succeeded" }, caller());
    expect(completed.status).toBe("succeeded");
    expect(completed.events.map((event: { sequence: number }) => event.sequence)).toEqual(completed.events.map((_event: unknown, index: number) => index + 1));
    await expect(transitionWorkflowRun({ workflowRunId: run.id, expectedRevision: 1, status: "running" }, caller())).rejects.toMatchObject({ code: "STALE_REVISION" });

    const restartedClient = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
    const restarted = await restartedClient.workflowRun.findUniqueOrThrow({ where: { id: run.id }, include: { steps: true, events: { orderBy: { sequence: "asc" } } } });
    await restartedClient.$disconnect();
    expect(restarted).toMatchObject({ id: run.id, status: "succeeded", inputJson: { task: "state" } });
    expect(restarted.events).toHaveLength(completed.events.length);
    await expect(getWorkflowRun(run.id, caller())).resolves.toMatchObject({ id: run.id, status: "succeeded" });
  });

  it("cancels all nonterminal steps atomically and rolls back a transition/event when U021 audit append fails", async () => {
    const run = await startWorkflowRun({ workflowDefinitionId, idempotencyKey: "cancel-and-audit", input: {} }, caller());
    const running = await transitionWorkflowRun({ workflowRunId: run.id, expectedRevision: 0, status: "running" }, caller());
    await transitionWorkflowStep({ workflowRunStepId: running.steps[0].id, expectedRevision: 0, status: "running" }, caller());
    const cancelled = await transitionWorkflowRun({ workflowRunId: run.id, expectedRevision: 1, status: "cancelled" }, caller());
    expect(cancelled.steps.every((step: { status: string }) => step.status === "cancelled")).toBe(true);

    const rollback = await startWorkflowRun({ workflowDefinitionId, idempotencyKey: "audit-rollback", input: {} }, caller());
    const rollbackRunning = await transitionWorkflowRun({ workflowRunId: rollback.id, expectedRevision: 0, status: "running" }, caller());
    const beforeEvents = rollbackRunning.events.length;
    await sharedDb.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION u025_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type = 'workflow.run.transitioned' THEN RAISE EXCEPTION 'forced audit failure'; END IF; RETURN NEW; END; $$;`);
    await sharedDb.$executeRawUnsafe(`CREATE TRIGGER u025_fail_audit_trg BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION u025_fail_audit();`);
    await expect(transitionWorkflowRun({ workflowRunId: rollback.id, expectedRevision: 1, status: "blocked" }, caller())).rejects.toThrow(/forced audit failure/i);
    const after = await fixture.workflowRun.findUniqueOrThrow({ where: { id: rollback.id }, include: { events: true } });
    expect(after).toMatchObject({ status: "running", revision: 1 });
    expect(after.events).toHaveLength(beforeEvents);
  });
});

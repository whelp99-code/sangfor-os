import { beforeEach, describe, expect, it, vi } from "vitest";

// approval-kernel.ts (and audit-db.ts/audit-chain.ts, which it calls unmocked — both are pure
// logic plus this same `prisma` seam) import prisma directly (no DI seam), so mock @sangfor/db at
// the module level with a small in-memory store that implements just enough real Prisma semantics
// (CAS via updateMany's WHERE predicate, unique-constraint rejection, findUniqueOrThrow) to
// exercise the kernel's actual branch logic — not a shallow "always resolve" stub. `$transaction`
// snapshots the store and restores it if the callback throws, faithfully modeling rollback for the
// audit-failure-without-rollback proof (full ACID/concurrency behavior is proven separately by
// approval-kernel.integration.test.ts against real PostgreSQL).
const fakeDb = vi.hoisted(() => {
  const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

  // Real Prisma always deserializes DateTime columns back into `Date` instances (never ISO
  // strings) — the kernel's own code (e.g. `applyExpiryIfDue`'s `expiresAt > now`) depends on
  // that. A plain JSON round-trip would silently turn every Date into a string, which then
  // compares as NaN against a real Date and corrupts every date-based branch. This reviver keeps
  // the JSON round-trip's deep-copy semantics (so mutating a returned row never mutates the
  // store) while restoring real Date objects, matching actual Prisma client behavior.
  function clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value), (_key, v) => (typeof v === "string" && ISO_DATE.test(v) ? new Date(v) : v)) as T;
  }

  interface Store {
    userCompanyRole: any[];
    artifactVersion: any[];
    approvalRequest: any[];
    approvalDecision: any[];
    approvalCurrentValidity: any[];
    outboxEvent: any[];
    auditLog: any[];
  }

  function emptyStore(): Store {
    return {
      userCompanyRole: [],
      artifactVersion: [],
      approvalRequest: [],
      approvalDecision: [],
      approvalCurrentValidity: [],
      outboxEvent: [],
      auditLog: [],
    };
  }

  let store = emptyStore();
  let idCounter = 0;
  const nextId = (prefix: string) => `${prefix}-${++idCounter}`;

  function matches(row: Record<string, unknown>, where: Record<string, unknown> | undefined): boolean {
    if (!where) return true;
    return Object.entries(where).every(([k, v]) => {
      if (v && typeof v === "object" && "in" in (v as Record<string, unknown>)) {
        return (v as { in: unknown[] }).in.includes(row[k]);
      }
      return row[k] === v;
    });
  }

  function findMany(table: any[], args: any = {}) {
    return table.filter((r) => matches(r, args.where));
  }
  function findFirst(table: any[], args: any = {}) {
    return findMany(table, args)[0] ?? null;
  }
  function findUnique(table: any[], args: any = {}) {
    return findFirst(table, args);
  }

  function makeClient(): any {
    const client = {
      userCompanyRole: {
        findMany: vi.fn(async (args: any) => clone(findMany(store.userCompanyRole, args))),
      },
      artifactVersion: {
        findUnique: vi.fn(async (args: any) => {
          const row = findUnique(store.artifactVersion, args);
          return row ? clone(row) : null;
        }),
      },
      approvalRequest: {
        create: vi.fn(async (args: any) => {
          // Mimics U018's BEFORE INSERT trigger (approval_request_validation_snapshot_guard):
          // fills validationSnapshotHash from validationSnapshot when the caller (correctly, per
          // U018 point 39) omitted it. The real digest algorithm is PostgreSQL-authoritative and
          // is proven byte-for-byte in packages/db/src/approval-schema.integration.test.ts; this
          // fake only needs a deterministic non-null stand-in so kernel branch logic is testable.
          const validationSnapshotHash =
            args.data.validationSnapshotHash ?? `fake-hash-${JSON.stringify(args.data.validationSnapshot ?? null).length}-${nextId("vsh")}`;
          const row = { id: nextId("appr"), createdAt: new Date(), updatedAt: new Date(), ...args.data, validationSnapshotHash };
          store.approvalRequest.push(row);
          return clone(row);
        }),
        findUnique: vi.fn(async (args: any) => {
          const row = findUnique(store.approvalRequest, args);
          return row ? clone(row) : null;
        }),
        findUniqueOrThrow: vi.fn(async (args: any) => {
          const row = findUnique(store.approvalRequest, args);
          if (!row) throw new Error("approvalRequest not found");
          return clone(row);
        }),
        updateMany: vi.fn(async (args: any) => {
          const rows = findMany(store.approvalRequest, args);
          for (const row of rows) Object.assign(row, args.data, { updatedAt: new Date() });
          return { count: rows.length };
        }),
      },
      approvalDecision: {
        create: vi.fn(async (args: any) => {
          const dupActor = store.approvalDecision.some(
            (r) => r.approvalRequestId === args.data.approvalRequestId && r.actorAssignmentId === args.data.actorAssignmentId,
          );
          const dupSeq = store.approvalDecision.some(
            (r) => r.approvalRequestId === args.data.approvalRequestId && r.sequence === args.data.sequence,
          );
          if (dupActor || dupSeq) {
            const err: any = new Error("Unique constraint failed");
            err.code = "P2002";
            throw err;
          }
          const row = { id: nextId("dec"), createdAt: new Date(), ...args.data };
          store.approvalDecision.push(row);
          return clone(row);
        }),
        findFirst: vi.fn(async (args: any) => {
          const row = findFirst(store.approvalDecision, args);
          return row ? clone(row) : null;
        }),
        findMany: vi.fn(async (args: any) => clone(findMany(store.approvalDecision, args))),
      },
      approvalCurrentValidity: {
        create: vi.fn(async (args: any) => {
          const row = { updatedAt: new Date(), ...args.data };
          store.approvalCurrentValidity.push(row);
          return clone(row);
        }),
        findUnique: vi.fn(async (args: any) => {
          const row = findUnique(store.approvalCurrentValidity, args);
          return row ? clone(row) : null;
        }),
        findUniqueOrThrow: vi.fn(async (args: any) => {
          const row = findUnique(store.approvalCurrentValidity, args);
          if (!row) throw new Error("approvalCurrentValidity not found");
          return clone(row);
        }),
        update: vi.fn(async (args: any) => {
          const row = findUnique(store.approvalCurrentValidity, args);
          if (!row) throw new Error("approvalCurrentValidity not found");
          Object.assign(row, args.data, { updatedAt: new Date() });
          return clone(row);
        }),
        updateMany: vi.fn(async (args: any) => {
          const rows = findMany(store.approvalCurrentValidity, args);
          for (const row of rows) Object.assign(row, args.data, { updatedAt: new Date() });
          return { count: rows.length };
        }),
      },
      outboxEvent: {
        create: vi.fn(async (args: any) => {
          const row = { id: nextId("outbox"), createdAt: new Date(), processedAt: null, ...args.data };
          store.outboxEvent.push(row);
          return clone(row);
        }),
      },
      auditLog: {
        findFirst: vi.fn(async (args: any) => {
          const row = findFirst(store.auditLog, args);
          return row ? clone(row) : null;
        }),
        create: vi.fn(async (args: any) => {
          const row = { id: nextId("audit"), createdAt: new Date(), ...args.data };
          store.auditLog.push(row);
          return clone(row);
        }),
      },
      $executeRaw: vi.fn(async () => 0),
      $transaction: vi.fn(async (fn: (tx: any) => Promise<unknown>) => {
        const snapshot = clone(store);
        try {
          return await fn(client);
        } catch (err) {
          store = snapshot;
          throw err;
        }
      }),
    };
    return client;
  }

  const prisma = makeClient();

  return {
    prisma,
    resetStore: () => {
      store = emptyStore();
      idCounter = 0;
    },
    seed: {
      userCompanyRole: (row: any) => store.userCompanyRole.push(row),
      artifactVersion: (row: any) => store.artifactVersion.push(row),
    },
    raw: () => store,
  };
});

vi.mock("@sangfor/db", async (importOriginal) => {
  // approval-kernel.ts calls audit-db.ts's appendAuditEvent unmocked (both are pure logic plus
  // this same prisma seam), which needs the REAL, pure `canonicalizeRfc8785` (no DB dependency) —
  // only `prisma`/`Prisma` are faked below.
  const actual = await importOriginal<typeof import("@sangfor/db")>();
  return {
    ...actual,
    prisma: fakeDb.prisma,
    Prisma: { JsonNull: Symbol("JsonNull") },
  };
});

import {
  ApprovalKernelError,
  cancelApprovalRequest,
  decideApproval,
  expireIfDue,
  markValidityStale,
  revokeValidity,
  submitApprovalRequest,
  type ApprovalKernelCaller,
  type CreateApprovalRequestInput,
} from "./approval-kernel";

const TENANT = "tenant-1";
const COMPANY = "company-1";
const PROJECT = "project-1";
const OTHER_COMPANY = "company-2";

const SCOPE = { tenantId: TENANT, companyId: COMPANY, projectId: PROJECT };

const ARTIFACT_VERSION_ID = "artv-1";
const ARTIFACT_HASH = "hash-abc";

function activeRole(id: string, userId: string, companyId = COMPANY) {
  return { id, userId, companyId, role: "account_manager", status: "active", validFrom: null, expiresAt: null, revokedAt: null };
}

function caller(overrides: Partial<ApprovalKernelCaller> = {}): ApprovalKernelCaller {
  return {
    userId: "user-requester",
    sessionId: "sess-requester",
    scope: SCOPE,
    mfaVerifiedAt: new Date(),
    ...overrides,
  };
}

function createInput(overrides: Partial<CreateApprovalRequestInput> = {}): CreateApprovalRequestInput {
  return {
    action: "release",
    artifactVersionId: ARTIFACT_VERSION_ID,
    artifactHash: ARTIFACT_HASH,
    policyVersion: "v1",
    requiredQuorum: 2,
    ...overrides,
  };
}

beforeEach(() => {
  fakeDb.resetStore();
  fakeDb.seed.userCompanyRole(activeRole("ucr-requester", "user-requester"));
  fakeDb.seed.userCompanyRole(activeRole("ucr-approver1", "user-approver1"));
  fakeDb.seed.userCompanyRole(activeRole("ucr-approver2", "user-approver2"));
  fakeDb.seed.userCompanyRole(activeRole("ucr-approver3", "user-approver3"));
  fakeDb.seed.userCompanyRole(activeRole("ucr-cross", "user-cross", OTHER_COMPANY));
  fakeDb.seed.artifactVersion({
    id: ARTIFACT_VERSION_ID,
    artifactId: "art-1",
    contentHash: ARTIFACT_HASH,
    artifact: { tenantId: TENANT, companyId: COMPANY, projectId: PROJECT },
  });
});

async function createReady(overrides: Partial<CreateApprovalRequestInput> = {}) {
  return submitApprovalRequest(createInput(overrides), caller());
}

describe("submitApprovalRequest — creation contract (§1)", () => {
  it("persists pending@0 then CASes to ready_for_human_approval@1 with a matching validity projection", async () => {
    const store = fakeDb.raw();
    const before = store.approvalRequest.length;
    const { request, validity } = await createReady();

    expect(before).toBe(0);
    expect(request.status).toBe("ready_for_human_approval");
    expect(request.revision).toBe(1);
    expect(request.legacyUnbound).toBe(false);
    expect(validity.state).toBe("pending");
    expect(validity.requestRevision).toBe(1);
    expect(validity.satisfiedQuorum).toBe(0);
    expect(validity.lastDecisionSequence).toBe(0);
    expect(validity.requiredQuorum).toBe(2);
  });

  it("returns a typed validation rejection when pending@0 cannot become ready@1", async () => {
    fakeDb.prisma.approvalRequest.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(createReady()).rejects.toMatchObject({
      code: "VALIDATION_REJECTED",
      httpStatus: 422,
      message: expect.stringContaining("unable to CAS pending request"),
    });
    expect(fakeDb.raw().approvalRequest).toHaveLength(0);
  });

  it("never lets a caller supply status or a readiness flag — the request type has no such fields", async () => {
    const withExtra = { ...createInput(), status: "approved", ready: true } as CreateApprovalRequestInput;
    const { request } = await submitApprovalRequest(withExtra, caller());
    // Whatever the caller smuggled in on the object is simply not read by the kernel.
    expect(request.status).toBe("ready_for_human_approval");
  });

  it("blocks (throws) when U018's validationSnapshotHash is absent on a canonical insert", async () => {
    const store = fakeDb.raw();
    const originalCreate = fakeDb.prisma.approvalRequest.create;
    fakeDb.prisma.approvalRequest.create = vi.fn(async (args: any) => {
      const row = await originalCreate(args);
      const stored = store.approvalRequest.find((r: any) => r.id === row.id);
      stored.validationSnapshotHash = null;
      return { ...row, validationSnapshotHash: null };
    });
    await expect(createReady()).rejects.toThrow(/U018 validationSnapshotHash/);
    fakeDb.prisma.approvalRequest.create = originalCreate;
  });

  it("rejects a mismatched artifactHash against the current ArtifactVersion content hash", async () => {
    await expect(createReady({ artifactHash: "wrong-hash" })).rejects.toMatchObject({ code: "HASH_MISMATCH" });
  });

  it("returns opaque NOT_FOUND for an artifactVersionId in a foreign scope", async () => {
    fakeDb.seed.artifactVersion({
      id: "artv-foreign",
      artifactId: "art-foreign",
      contentHash: "h",
      artifact: { tenantId: TENANT, companyId: OTHER_COMPANY, projectId: "project-2" },
    });
    await expect(createReady({ artifactVersionId: "artv-foreign", artifactHash: "h" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects a non-positive requiredQuorum", async () => {
    await expect(createReady({ requiredQuorum: 0 })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});

describe("decideApproval — canonical decision input (§2)", () => {
  it("rejects an unknown decision string and appends nothing", async () => {
    const { request } = await createReady();
    await expect(
      decideApproval({ approvalId: request.id, decision: "super-approve", expectedRevision: 1 }, caller({ userId: "user-approver1", sessionId: "s1" })),
    ).rejects.toMatchObject({ code: "UNKNOWN_DECISION" });
    expect(fakeDb.raw().approvalDecision).toHaveLength(0);
  });

  it("rejects a direct decision against a non-READY (pending) request", async () => {
    const store = fakeDb.raw();
    // Force the request back to `pending` to simulate a request that never completed validation.
    const before = await createReady();
    const row = store.approvalRequest.find((r: any) => r.id === before.request.id);
    row.status = "pending";
    row.revision = 0;

    await expect(
      decideApproval({ approvalId: before.request.id, decision: "approve", expectedRevision: 0 }, caller({ userId: "user-approver1", sessionId: "s1" })),
    ).rejects.toMatchObject({ code: "NOT_READY" });
  });

  it("rejects a decision with a stale expectedRevision", async () => {
    const { request } = await createReady();
    await expect(
      decideApproval({ approvalId: request.id, decision: "approve", expectedRevision: 0 }, caller({ userId: "user-approver1", sessionId: "s1" })),
    ).rejects.toMatchObject({ code: "STALE_REVISION" });
  });

  it("rejects the requester deciding their own request (self-approval)", async () => {
    const { request } = await createReady();
    await expect(
      decideApproval({ approvalId: request.id, decision: "approve", expectedRevision: 1 }, caller({ userId: "user-requester", sessionId: "s0" })),
    ).rejects.toMatchObject({ code: "SELF_APPROVAL" });
  });

  it("rejects a caller with no active company role", async () => {
    const { request } = await createReady();
    await expect(
      decideApproval({ approvalId: request.id, decision: "approve", expectedRevision: 1 }, caller({ userId: "user-unknown", sessionId: "s9" })),
    ).rejects.toMatchObject({ code: "INACTIVE_ROLE" });
  });

  it("rejects a decision with no fresh MFA evidence", async () => {
    const { request } = await createReady();
    await expect(
      decideApproval(
        { approvalId: request.id, decision: "approve", expectedRevision: 1 },
        caller({ userId: "user-approver1", sessionId: "s1", mfaVerifiedAt: null }),
      ),
    ).rejects.toMatchObject({ code: "MFA_REQUIRED" });
  });

  it("rejects a decision whose MFA is stale beyond the privileged freshness window", async () => {
    const { request } = await createReady();
    const staleMfa = new Date(Date.now() - 1000 * 60 * 60);
    await expect(
      decideApproval(
        { approvalId: request.id, decision: "approve", expectedRevision: 1 },
        caller({ userId: "user-approver1", sessionId: "s1", mfaVerifiedAt: staleMfa }),
      ),
    ).rejects.toMatchObject({ code: "MFA_STALE" });
  });

  it("returns opaque NOT_FOUND for a cross-company decision (no explicit scope selector exists in the canonical input)", async () => {
    const { request } = await createReady();
    await expect(
      decideApproval(
        { approvalId: request.id, decision: "approve", expectedRevision: 1 },
        caller({ userId: "user-cross", sessionId: "sc", scope: { tenantId: TENANT, companyId: OTHER_COMPANY, projectId: "project-2" } }),
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("returns NOT_FOUND for an opaque nonexistent approvalId", async () => {
    await expect(
      decideApproval({ approvalId: "does-not-exist", decision: "approve", expectedRevision: 0 }, caller({ userId: "user-approver1", sessionId: "s1" })),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects a decision against an expired request without mutating it (expiry's own DB transition is expireIfDue's separately committed job)", async () => {
    const store = fakeDb.raw();
    const { request } = await createReady();
    const row = store.approvalRequest.find((r: any) => r.id === request.id);
    row.expiresAt = new Date(Date.now() - 1000);

    await expect(
      decideApproval({ approvalId: request.id, decision: "approve", expectedRevision: 1 }, caller({ userId: "user-approver1", sessionId: "s1" })),
    ).rejects.toMatchObject({ code: "EXPIRED" });
    const persisted = fakeDb.raw().approvalRequest.find((r: any) => r.id === request.id);
    expect(persisted.status).toBe("ready_for_human_approval");
  });
});

describe("quorum accounting (§4) — under-quorum nonterminal, reject never counted, duplicate approver", () => {
  it("an approve below quorum appends one decision, stays ready_for_human_approval, and is explicitly nonterminal", async () => {
    const { request } = await createReady({ requiredQuorum: 2 });

    const result = await decideApproval(
      { approvalId: request.id, decision: "approve", expectedRevision: 1 },
      caller({ userId: "user-approver1", sessionId: "s1" }),
    );

    expect(result.outcome).toBe("recorded_nonterminal");
    expect(result.request.status).toBe("ready_for_human_approval");
    expect(result.request.revision).toBe(2);
    expect(result.validity.state).toBe("pending");
    expect(result.validity.satisfiedQuorum).toBe(1);
    expect(result.validity.requestRevision).toBe(2);
  });

  it("the final distinct approve transitions to terminal approved/valid", async () => {
    const { request } = await createReady({ requiredQuorum: 2 });
    await decideApproval({ approvalId: request.id, decision: "approve", expectedRevision: 1 }, caller({ userId: "user-approver1", sessionId: "s1" }));

    const final = await decideApproval(
      { approvalId: request.id, decision: "approve", expectedRevision: 2 },
      caller({ userId: "user-approver2", sessionId: "s2" }),
    );

    expect(final.outcome).toBe("approved");
    expect(final.request.status).toBe("approved");
    expect(final.request.revision).toBe(3);
    expect(final.validity.state).toBe("valid");
    expect(final.validity.satisfiedQuorum).toBe(2);
    expect(final.validity.evaluatedAt).not.toBeNull();
  });

  it("reject never increments satisfiedQuorum and transitions immediately to terminal rejected/invalid", async () => {
    const { request } = await createReady({ requiredQuorum: 2 });

    const result = await decideApproval(
      { approvalId: request.id, decision: "reject", expectedRevision: 1 },
      caller({ userId: "user-approver1", sessionId: "s1" }),
    );

    expect(result.outcome).toBe("rejected");
    expect(result.request.status).toBe("rejected");
    expect(result.validity.state).toBe("invalid");
    expect(result.validity.satisfiedQuorum).toBe(0);
  });

  it("rejects a duplicate approver deciding the same request twice", async () => {
    const { request } = await createReady({ requiredQuorum: 3 });
    await decideApproval({ approvalId: request.id, decision: "approve", expectedRevision: 1 }, caller({ userId: "user-approver1", sessionId: "s1" }));

    await expect(
      decideApproval({ approvalId: request.id, decision: "reject", expectedRevision: 2 }, caller({ userId: "user-approver1", sessionId: "s1b" })),
    ).rejects.toMatchObject({ code: "DUPLICATE_APPROVER" });
  });
});

describe("terminal states never reopen (§3)", () => {
  it("rejects every later mutation once approved, including a CAS carrying the latest revision", async () => {
    const { request } = await createReady({ requiredQuorum: 1 });
    const approved = await decideApproval(
      { approvalId: request.id, decision: "approve", expectedRevision: 1 },
      caller({ userId: "user-approver1", sessionId: "s1" }),
    );
    expect(approved.request.status).toBe("approved");

    await expect(
      decideApproval(
        { approvalId: request.id, decision: "approve", expectedRevision: approved.request.revision },
        caller({ userId: "user-approver2", sessionId: "s2" }),
      ),
    ).rejects.toMatchObject({ code: "TERMINAL_STATE" });
  });

  it("rejects a replay against a terminal rejected request even at its latest revision", async () => {
    const { request } = await createReady({ requiredQuorum: 2 });
    const rejected = await decideApproval(
      { approvalId: request.id, decision: "reject", expectedRevision: 1 },
      caller({ userId: "user-approver1", sessionId: "s1" }),
    );

    await expect(
      decideApproval(
        { approvalId: request.id, decision: "approve", expectedRevision: rejected.request.revision },
        caller({ userId: "user-approver2", sessionId: "s2" }),
      ),
    ).rejects.toMatchObject({ code: "TERMINAL_STATE" });
  });

  it("cancelled requests reject illegal resurrection via decide", async () => {
    const { request } = await createReady();
    await cancelApprovalRequest(request.id, 1);
    await expect(
      decideApproval({ approvalId: request.id, decision: "approve", expectedRevision: 2 }, caller({ userId: "user-approver1", sessionId: "s1" })),
    ).rejects.toMatchObject({ code: "TERMINAL_STATE" });
  });
});

describe("audit failure rolls back the whole decision (§5, §9)", () => {
  it("never marks approved / appends a decision when the audit append fails", async () => {
    const { request } = await createReady({ requiredQuorum: 1 });
    const beforeRevision = fakeDb.raw().approvalRequest.find((r: any) => r.id === request.id).revision;
    const beforeDecisions = fakeDb.raw().approvalDecision.length;

    fakeDb.prisma.auditLog.create.mockRejectedValueOnce(new Error("forced audit failure"));

    await expect(
      decideApproval({ approvalId: request.id, decision: "approve", expectedRevision: 1 }, caller({ userId: "user-approver1", sessionId: "s1" })),
    ).rejects.toThrow("forced audit failure");

    // Re-fetch the store AFTER the rejection — `$transaction`'s catch path swaps in a restored
    // pre-transaction snapshot object, so a reference captured before the call would still point
    // at the (mutated-then-abandoned) in-flight object rather than the rolled-back state.
    const after = fakeDb.raw().approvalRequest.find((r: any) => r.id === request.id);
    expect(after.revision).toBe(beforeRevision);
    expect(after.status).toBe("ready_for_human_approval");
    expect(fakeDb.raw().approvalDecision).toHaveLength(beforeDecisions);
  });
});

describe("expiry, cancel, stale/revoked validity transitions (§3, §6)", () => {
  it("expireIfDue transitions an overdue ready request to expired without appending a decision", async () => {
    const store = fakeDb.raw();
    const { request } = await createReady();
    const row = store.approvalRequest.find((r: any) => r.id === request.id);
    row.expiresAt = new Date(Date.now() - 1000);

    const result = await expireIfDue(request.id);
    expect(result.status).toBe("expired");
    expect(store.approvalDecision).toHaveLength(0);
  });

  it("cancelApprovalRequest transitions ready_for_human_approval -> cancelled without a decision", async () => {
    const { request } = await createReady();
    const result = await cancelApprovalRequest(request.id, 1);
    expect(result.status).toBe("cancelled");
    expect(fakeDb.raw().approvalDecision).toHaveLength(0);
  });

  it("cannot cancel an already-terminal request", async () => {
    const { request } = await createReady({ requiredQuorum: 1 });
    await decideApproval({ approvalId: request.id, decision: "reject", expectedRevision: 1 }, caller({ userId: "user-approver1", sessionId: "s1" }));
    await expect(cancelApprovalRequest(request.id, 2)).rejects.toMatchObject({ code: "TERMINAL_STATE" });
  });

  it("markValidityStale moves pending|valid -> stale without deleting decision history", async () => {
    const { request } = await createReady({ requiredQuorum: 1 });
    const decided = await decideApproval(
      { approvalId: request.id, decision: "approve", expectedRevision: 1 },
      caller({ userId: "user-approver1", sessionId: "s1" }),
    );
    expect(decided.validity.state).toBe("valid");

    const store = fakeDb.raw();
    const decisionCountBefore = store.approvalDecision.filter((d: any) => d.approvalRequestId === request.id).length;
    const requestBefore = { ...store.approvalRequest.find((r: any) => r.id === request.id) };

    const stale = await markValidityStale(request.id, "superseded_by_new_version");
    expect(stale.state).toBe("stale");
    expect(stale.invalidatedAt).not.toBeNull();

    const decisionCountAfter = store.approvalDecision.filter((d: any) => d.approvalRequestId === request.id).length;
    expect(decisionCountAfter).toBe(decisionCountBefore);
    const requestAfter = store.approvalRequest.find((r: any) => r.id === request.id);
    expect(requestAfter.status).toBe(requestBefore.status);
    expect(requestAfter.revision).toBe(requestBefore.revision);
  });

  it("a stale/expired/revoked projection can never resurrect to valid", async () => {
    const { request } = await createReady({ requiredQuorum: 1 });
    await decideApproval({ approvalId: request.id, decision: "approve", expectedRevision: 1 }, caller({ userId: "user-approver1", sessionId: "s1" }));
    await markValidityStale(request.id, "superseded");

    await expect(markValidityStale(request.id, "again")).rejects.toMatchObject({ code: "ILLEGAL_TRANSITION" });
    await expect(revokeValidity(request.id, "revoke-attempt")).rejects.toMatchObject({ code: "ILLEGAL_TRANSITION" });
  });

  it("revokeValidity transitions valid -> revoked explicitly", async () => {
    const { request } = await createReady({ requiredQuorum: 1 });
    await decideApproval({ approvalId: request.id, decision: "approve", expectedRevision: 1 }, caller({ userId: "user-approver1", sessionId: "s1" }));
    const revoked = await revokeValidity(request.id, "governance_revocation");
    expect(revoked.state).toBe("revoked");
  });
});

describe("ApprovalKernelError HTTP status mapping", () => {
  it("exposes a stable numeric httpStatus per error code", async () => {
    try {
      await decideApproval({ approvalId: "nope", decision: "approve", expectedRevision: 0 }, caller({ userId: "user-approver1", sessionId: "s1" }));
      throw new Error("expected to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ApprovalKernelError);
      expect((err as ApprovalKernelError).httpStatus).toBe(404);
    }
  });
});

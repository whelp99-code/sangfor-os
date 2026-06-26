import { describe, expect, it } from "vitest";

import { AUDIT_CHAIN_ZERO_HASH, AuditChain } from "../../src/audit-chain";
import { verifyPersistedAuditLogs } from "../../src/audit-db";

describe("audit DB integrity helpers", () => {
  it("verifies persisted hash-chain logs in timestamp order", () => {
    const first = AuditChain.createEvent(
      "quote.created",
      "user-1",
      "quote",
      "quote-1",
      { amount: 1000 },
      AUDIT_CHAIN_ZERO_HASH,
    );
    const second = AuditChain.createEvent(
      "quote.approved",
      "user-2",
      "quote",
      "quote-1",
      { approverPersonaId: "persona-1" },
      first.hash,
    );

    expect(
      verifyPersistedAuditLogs([
        {
          eventType: first.eventType,
          actorId: first.actorId,
          resourceType: first.resourceType,
          resourceId: first.resourceId,
          details: first.details,
          previousHash: first.previousHash,
          eventHash: first.hash,
          timestamp: new Date(first.timestamp),
        },
        {
          eventType: second.eventType,
          actorId: second.actorId,
          resourceType: second.resourceType,
          resourceId: second.resourceId,
          details: second.details,
          previousHash: second.previousHash,
          eventHash: second.hash,
          timestamp: new Date(second.timestamp),
        },
      ]),
    ).toBe(true);
  });

  it("rejects persisted logs without event hashes", () => {
    expect(
      verifyPersistedAuditLogs([
        {
          eventType: "legacy.event",
          actorId: "user-1",
          resourceType: "legacy",
          resourceId: "legacy-1",
          details: {},
          previousHash: AUDIT_CHAIN_ZERO_HASH,
          eventHash: null,
          timestamp: new Date(),
        },
      ]),
    ).toBe(false);
  });

  it("rejects tampered persisted details", () => {
    const event = AuditChain.createEvent(
      "asset.created",
      "user-1",
      "asset",
      "asset-1",
      { serialNumber: "SN-001" },
      AUDIT_CHAIN_ZERO_HASH,
    );

    expect(
      verifyPersistedAuditLogs([
        {
          eventType: event.eventType,
          actorId: event.actorId,
          resourceType: event.resourceType,
          resourceId: event.resourceId,
          details: { serialNumber: "SN-CHANGED" },
          previousHash: event.previousHash,
          eventHash: event.hash,
          timestamp: new Date(event.timestamp),
        },
      ]),
    ).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { AuditChain } from "../../src/audit-chain";

describe("AuditChain", () => {
  it("starts with empty events and zero hash", () => {
    const chain = new AuditChain();
    expect(chain.getEvents()).toEqual([]);
    expect(chain.getLastHash()).toBe("0".repeat(64));
    expect(chain.verifyIntegrity()).toBe(true);
  });

  it("records a single event and computes hash", () => {
    const chain = new AuditChain();
    const event = chain.record("user.login", "user-1", "session", "sess-123", { ip: "10.0.0.1" });

    expect(event.id).toMatch(/^audit-/);
    expect(event.eventType).toBe("user.login");
    expect(event.actorId).toBe("user-1");
    expect(event.resourceType).toBe("session");
    expect(event.resourceId).toBe("sess-123");
    expect(event.details).toEqual({ ip: "10.0.0.1" });
    expect(event.previousHash).toBe("0".repeat(64));
    expect(event.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(event.timestamp).toBeTruthy();

    expect(chain.getEvents()).toHaveLength(1);
    expect(chain.getLastHash()).toBe(event.hash);
  });

  it("chains events sequentially", () => {
    const chain = new AuditChain();
    const event1 = chain.record("user.login", "user-1", "session", "sess-1");
    const event2 = chain.record("data.read", "user-1", "document", "doc-42");

    expect(event2.previousHash).toBe(event1.hash);
    expect(chain.getEvents()).toHaveLength(2);
  });

  it("can create an event from a persisted previous hash", () => {
    const event = AuditChain.createEvent(
      "quote.approved",
      "approver-1",
      "quote",
      "quote-1",
      { gate: "commercial" },
      "a".repeat(64),
    );

    expect(event.previousHash).toBe("a".repeat(64));
    expect(event.hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("hashes details deterministically regardless of object key order", () => {
    const left = AuditChain.computeHash(
      "quote.created",
      "user-1",
      "quote",
      "quote-1",
      { z: 1, a: { b: 2, a: 1 } },
      "2026-06-26T00:00:00.000Z",
      "0".repeat(64),
    );
    const right = AuditChain.computeHash(
      "quote.created",
      "user-1",
      "quote",
      "quote-1",
      { a: { a: 1, b: 2 }, z: 1 },
      "2026-06-26T00:00:00.000Z",
      "0".repeat(64),
    );

    expect(left).toBe(right);
  });

  it("verifies integrity of unmodified chain", () => {
    const chain = new AuditChain();
    chain.record("event.a", "actor-1", "type-a", "res-1");
    chain.record("event.b", "actor-2", "type-b", "res-2");
    chain.record("event.c", "actor-3", "type-c", "res-3");

    expect(chain.verifyIntegrity()).toBe(true);
  });

  it("detects tampered event hash", () => {
    const chain = new AuditChain();
    chain.record("event.a", "actor-1", "type-a", "res-1");
    chain.record("event.b", "actor-2", "type-b", "res-2");

    const events = chain.getEvents();
    (events[1] as { hash: string }).hash = "tampered";

    expect(chain.verifyIntegrity()).toBe(false);
  });

  it("detects broken previousHash linkage", () => {
    const chain = new AuditChain();
    chain.record("event.a", "actor-1", "type-a", "res-1");
    chain.record("event.b", "actor-2", "type-b", "res-2");

    const events = chain.getEvents();
    (events[1] as { previousHash: string }).previousHash = "0000";

    expect(chain.verifyIntegrity()).toBe(false);
  });

  it("detects tampered event data", () => {
    const chain = new AuditChain();
    chain.record("event.a", "actor-1", "type-a", "res-1");

    const events = chain.getEvents();
    (events[0] as { eventType: string }).eventType = "malicious.edit";

    expect(chain.verifyIntegrity()).toBe(false);
  });

  it("getEvents returns a copy, not the internal array", () => {
    const chain = new AuditChain();
    chain.record("evt", "a", "type", "id");
    const eventsCopy = chain.getEvents();
    eventsCopy.push({} as any);
    expect(chain.getEvents()).toHaveLength(1);
  });

  it("records event with empty details default", () => {
    const chain = new AuditChain();
    const event = chain.record("test.event", "actor-1", "resource-type", "resource-id");
    expect(event.details).toEqual({});
  });

  it("maintains integrity after many events", () => {
    const chain = new AuditChain();
    for (let i = 0; i < 100; i++) {
      chain.record(`event-${i}`, `actor-${i}`, `type-${i}`, `res-${i}`);
    }
    expect(chain.verifyIntegrity()).toBe(true);
    expect(chain.getEvents()).toHaveLength(100);
  });
});

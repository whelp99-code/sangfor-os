import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * upsertDomainMemory 의 embedding 매핑 계약 (DB 불필요, prisma 모킹).
 * 생략/빈 배열은 컬럼을 건드리지 않아 기존 벡터가 살아남고, 실제 벡터만 기록된다.
 */
const mocks = vi.hoisted(() => ({
  upsert: vi.fn(async (_args: Record<string, unknown>) => ({}) as never),
  findUniqueOrThrow: vi.fn(async () => ({ id: "project-1" })),
}));

vi.mock("@sangfor/db", () => ({
  Prisma: {},
  prisma: {
    domainMemory: { upsert: mocks.upsert },
    project: { findUniqueOrThrow: mocks.findUniqueOrThrow },
  },
}));

const { upsertDomainMemory } = await import("./domain-memory");

const base = {
  projectSlug: "unit-test-project",
  domain: "sales" as const,
  memoryType: "case" as const,
  key: "k1",
  label: "prior case",
};

function payloads() {
  const args = mocks.upsert.mock.calls[0]![0] as {
    update: Record<string, unknown>;
    create: Record<string, unknown>;
  };
  return args;
}

describe("upsertDomainMemory — embedding column mapping", () => {
  beforeEach(() => {
    mocks.upsert.mockClear();
  });

  it("writes the vector when a real embedding is supplied", async () => {
    await upsertDomainMemory({ ...base, embedding: [0.1, 0.2, 0.3] });

    const { update, create } = payloads();
    expect(update.embedding).toEqual([0.1, 0.2, 0.3]);
    expect(create.embedding).toEqual([0.1, 0.2, 0.3]);
  });

  it("leaves the column untouched when embedding is omitted (keeps the prior vector)", async () => {
    await upsertDomainMemory(base);

    const { update, create } = payloads();
    expect(update).not.toHaveProperty("embedding");
    expect(create).not.toHaveProperty("embedding");
  });

  it("treats an empty vector as no embedding rather than wiping the stored one", async () => {
    await upsertDomainMemory({ ...base, embedding: [] });

    const { update, create } = payloads();
    expect(update).not.toHaveProperty("embedding");
    expect(create).not.toHaveProperty("embedding");
  });
});

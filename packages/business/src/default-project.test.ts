import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { resolveDefaultProjectId, resolveDefaultProjectSlug, type PrismaClientLike } from "./default-project";

function fakeClient(rows: Array<{ id: string; slug: string; name: string }>): PrismaClientLike {
  return {
    project: {
      findMany: async () => rows,
    },
  };
}

describe("resolveDefaultProjectId", () => {
  const OGA = { ...process.env };

  beforeEach(() => {
    // Start each test with clean env
    delete process.env.DEFAULT_PROJECT_ID;
  });
  afterEach(() => {
    process.env = { ...OGA };
  });

  it("returns env var when DEFAULT_PROJECT_ID is set", async () => {
    process.env.DEFAULT_PROJECT_ID = "env-override-id";
    const result = await resolveDefaultProjectId(fakeClient([]));
    expect(result).toBe("env-override-id");
  });

  it("returns the id when exactly one project row exists", async () => {
    const result = await resolveDefaultProjectId(
      fakeClient([{ id: "abc", slug: "demo-project", name: "Demo" }]),
    );
    expect(result).toBe("abc");
  });

  it("throws when no project rows exist", async () => {
    await expect(resolveDefaultProjectId(fakeClient([]))).rejects.toThrow(
      "resolveDefaultProjectId: no project found",
    );
  });

  it("throws when multiple project rows exist", async () => {
    await expect(
      resolveDefaultProjectId(
        fakeClient([
          { id: "a", slug: "one", name: "One" },
          { id: "b", slug: "two", name: "Two" },
        ]),
      ),
    ).rejects.toThrow("resolveDefaultProjectId: ambiguous");
  });
});

describe("resolveDefaultProjectSlug", () => {
  const OGA = { ...process.env };

  beforeEach(() => {
    delete process.env.DEFAULT_PROJECT_SLUG;
  });
  afterEach(() => {
    process.env = { ...OGA };
  });

  it("returns env var when DEFAULT_PROJECT_SLUG is set", async () => {
    process.env.DEFAULT_PROJECT_SLUG = "env-override-slug";
    const result = await resolveDefaultProjectSlug(fakeClient([]));
    expect(result).toBe("env-override-slug");
  });

  it("returns the slug when exactly one project row exists", async () => {
    const result = await resolveDefaultProjectSlug(
      fakeClient([{ id: "abc", slug: "my-proj", name: "My Project" }]),
    );
    expect(result).toBe("my-proj");
  });

  it("throws when no project rows exist", async () => {
    await expect(resolveDefaultProjectSlug(fakeClient([]))).rejects.toThrow(
      "resolveDefaultProjectSlug: no project found",
    );
  });

  it("throws when multiple project rows exist", async () => {
    await expect(
      resolveDefaultProjectSlug(
        fakeClient([
          { id: "a", slug: "one", name: "One" },
          { id: "b", slug: "two", name: "Two" },
        ]),
      ),
    ).rejects.toThrow("resolveDefaultProjectSlug: ambiguous");
  });
});

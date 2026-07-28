import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ userFindUnique: vi.fn(), credentialUpdate: vi.fn(), executeRaw: vi.fn() }));
vi.mock("@sangfor/db", () => ({
  Prisma: { sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values })) },
  prisma: {
    user: { findUnique: mocks.userFindUnique },
    userCredential: { update: mocks.credentialUpdate },
    $executeRaw: mocks.executeRaw,
  },
}));

import { authenticatePasswordCredential, hashPasswordCredential, verifyPasswordDigest } from "./password-credential";

describe("password credential digest", () => {
  beforeEach(() => {
    mocks.userFindUnique.mockReset();
    mocks.credentialUpdate.mockReset().mockResolvedValue({});
    mocks.executeRaw.mockReset().mockResolvedValue(1);
  });
  it("hashes with a unique salt and verifies only the matching password", async () => {
    const first = await hashPasswordCredential("correct horse battery staple");
    const second = await hashPasswordCredential("correct horse battery staple");
    expect(first).not.toBe(second);
    await expect(verifyPasswordDigest("correct horse battery staple", first)).resolves.toBe(true);
    await expect(verifyPasswordDigest("wrong password value", first)).resolves.toBe(false);
  });
  it("rejects malformed digests and short provisioning passwords", async () => {
    await expect(verifyPasswordDigest("anything", "$scrypt$v1$bad$bad")).resolves.toBe(false);
    await expect(hashPasswordCredential("too-short")).rejects.toThrow(/16-1024/u);
  });
  it("persists failed attempts and locks the fifth failure", async () => {
    const digest = await hashPasswordCredential("correct horse battery staple");
    mocks.userFindUnique.mockResolvedValue({ id: "user-1", status: "active", disabledAt: null, credential: { passwordDigest: digest, credentialVersion: 3, failedAttempts: 4, lockedUntil: null } });
    await expect(authenticatePasswordCredential("USER@EXAMPLE.COM", "incorrect credential value", new Date("2026-07-28T00:00:00Z"))).resolves.toBeNull();
    expect(mocks.executeRaw).toHaveBeenCalledTimes(1);
  });
  it("resets lock counters after a valid credential", async () => {
    const password = "correct horse battery staple";
    const digest = await hashPasswordCredential(password);
    mocks.userFindUnique.mockResolvedValue({ id: "user-1", status: "active", disabledAt: null, credential: { passwordDigest: digest, credentialVersion: 3, failedAttempts: 2, lockedUntil: null } });
    await expect(authenticatePasswordCredential("user@example.com", password, new Date("2026-07-28T00:00:00Z"))).resolves.toEqual({ userId: "user-1", credentialVersion: 3 });
    expect(mocks.credentialUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ failedAttempts: 0, lockedUntil: null }) }));
  });
});

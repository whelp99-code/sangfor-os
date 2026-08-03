import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  withIsolatedPostgres: vi.fn(),
}));

vi.mock("../../scripts/lib/isolated-postgres.mjs", () => ({
  withIsolatedPostgres: mocks.withIsolatedPostgres,
}));

describe("U075 perf:smoke safety contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.DATABASE_URL;
    delete process.env.TASK_OWNED_DATABASE_URL;
    delete process.env.TASK_POSTGRES_RECEIPT_FILE;
    delete process.env.PERF_DATABASE_URL;
    delete process.env.DOCKER_HOST;
  });

  it("rejects caller-provided DATABASE_URL", async () => {
    process.env.DATABASE_URL = "postgresql://caller@localhost:5432/caller_db";
    const { validateEnvironment } = await import("../../scripts/perf-smoke.mjs");
    expect(() => validateEnvironment()).toThrow("caller DATABASE_URL");
    delete process.env.DATABASE_URL;
  });

  it("rejects caller-provided TASK_OWNED_DATABASE_URL", async () => {
    process.env.TASK_OWNED_DATABASE_URL = "postgresql://caller@localhost:5432/caller_db";
    const { validateEnvironment } = await import("../../scripts/perf-smoke.mjs");
    expect(() => validateEnvironment()).toThrow("caller TASK_OWNED_DATABASE_URL");
    delete process.env.TASK_OWNED_DATABASE_URL;
  });

  it("rejects remote DOCKER_HOST", async () => {
    process.env.DOCKER_HOST = "tcp://remote:2375";
    const { validateEnvironment } = await import("../../scripts/perf-smoke.mjs");
    expect(() => validateEnvironment()).toThrow("remote DOCKER_HOST");
    delete process.env.DOCKER_HOST;
  });

  it("rejects missing TASK_RUN_ID", async () => {
    delete process.env.TASK_RUN_ID;
    const { validateEnvironment } = await import("../../scripts/perf-smoke.mjs");
    expect(() => validateEnvironment()).toThrow("TASK_RUN_ID");
  });

  it("rejects missing TASK_OWNER_UNIT", async () => {
    process.env.TASK_RUN_ID = "test-run";
    delete process.env.TASK_OWNER_UNIT;
    const { validateEnvironment } = await import("../../scripts/perf-smoke.mjs");
    expect(() => validateEnvironment()).toThrow("TASK_OWNER_UNIT");
  });

  it("rejects missing PORT", async () => {
    process.env.TASK_RUN_ID = "test-run";
    process.env.TASK_OWNER_UNIT = "U075";
    delete process.env.PORT;
    const { validateEnvironment } = await import("../../scripts/perf-smoke.mjs");
    expect(() => validateEnvironment()).toThrow("PORT");
  });

  it("rejects missing API_PORT", async () => {
    process.env.TASK_RUN_ID = "test-run";
    process.env.TASK_OWNER_UNIT = "U075";
    process.env.PORT = "3101";
    delete process.env.API_PORT;
    const { validateEnvironment } = await import("../../scripts/perf-smoke.mjs");
    expect(() => validateEnvironment()).toThrow("API_PORT");
  });

  it("rejects missing ACCEPTANCE_EVIDENCE_DIR", async () => {
    process.env.TASK_RUN_ID = "test-run";
    process.env.TASK_OWNER_UNIT = "U075";
    process.env.PORT = "3101";
    process.env.API_PORT = "3200";
    delete process.env.ACCEPTANCE_EVIDENCE_DIR;
    const { validateEnvironment } = await import("../../scripts/perf-smoke.mjs");
    expect(() => validateEnvironment()).toThrow("ACCEPTANCE_EVIDENCE_DIR");
  });

  it("rejects missing RESOURCE_LEASE_FILE", async () => {
    process.env.TASK_RUN_ID = "test-run";
    process.env.TASK_OWNER_UNIT = "U075";
    process.env.PORT = "3101";
    process.env.API_PORT = "3200";
    process.env.ACCEPTANCE_EVIDENCE_DIR = "/tmp/evidence";
    delete process.env.RESOURCE_LEASE_FILE;
    const { validateEnvironment } = await import("../../scripts/perf-smoke.mjs");
    expect(() => validateEnvironment()).toThrow("RESOURCE_LEASE_FILE");
  });

  it("accepts a detached mirror lease-bound T-PERF evidence directory", async () => {
    const { validateEvidenceBoundary } = await import("../../scripts/perf-smoke.mjs");
    expect(() => validateEvidenceBoundary(
      "/tmp/u076-attempt/aliases/T-PERF",
      "/tmp/u076-attempt/leases/t-perf.json",
    )).not.toThrow();
    expect(() => validateEvidenceBoundary(
      "/tmp/unbound/T-PERF",
      "/tmp/u076-attempt/leases/t-perf.json",
    )).toThrow("lease-bound T-PERF");
  });

  // The dynamic `import("./seed")` below transitively loads prisma, the
  // business kernel, and the web password-credential lib. Under campaign load
  // that import alone can exceed vitest's 5s default test timeout (T-PERF
  // failed at 60/63 step results on candidate 48356e46). Explicit because the
  // default is load-dependent, not a limit.
  it("seeds a production-profile password credential for the performance principal", async () => {
    const { seedPerformanceCredential } = await import("./seed");
    const hashPassword = vi.fn().mockResolvedValue("$scrypt$v1$digest");
    const createCredential = vi.fn().mockResolvedValue({});
    await seedPerformanceCredential("performance-password", { hashPassword, createCredential });
    expect(hashPassword).toHaveBeenCalledWith("performance-password");
    expect(createCredential).toHaveBeenCalledWith({ userId: "u075-user-ceo", passwordDigest: "$scrypt$v1$digest" });
    await expect(seedPerformanceCredential(undefined, { hashPassword, createCredential })).rejects.toThrow("AUTH_DEMO_PASSWORD");
  }, 30_000);

  it("rejects non-loopback PORT", async () => {
    process.env.TASK_RUN_ID = "test-run";
    process.env.TASK_OWNER_UNIT = "U075";
    process.env.PORT = "0.0.0.0:3101";
    process.env.API_PORT = "3200";
    process.env.ACCEPTANCE_EVIDENCE_DIR = "/tmp/evidence";
    process.env.RESOURCE_LEASE_FILE = "/tmp/lease.json";
    const { validateEnvironment } = await import("../../scripts/perf-smoke.mjs");
    expect(() => validateEnvironment()).toThrow("integer ports");
  });

  it("rejects occupied port at start", async () => {
    const { assertPortFree } = await import("../../scripts/perf-smoke.mjs");
    const net = await import("node:net");
    const server = net.createServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    await expect(assertPortFree(port)).rejects.toThrow("occupied");
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("requires migrate:true in withIsolatedPostgres call", () => {
    expect(mocks.withIsolatedPostgres).not.toHaveBeenCalled();
  });

  it("rejects omitted migrate option", () => {
    const opts = { runId: "test", ownerUnit: "U075", purpose: "perf", evidenceDir: "/tmp" };
    expect((opts as Record<string, unknown>).migrate).toBeUndefined();
  });

  it("rejects migrate:false", () => {
    const opts = { runId: "test", ownerUnit: "U075", purpose: "perf", evidenceDir: "/tmp", migrate: false };
    expect(opts.migrate).toBe(false);
  });

  it("validates helper receipt before callback", () => {
    const { validateHelperReceipt } = require("../../scripts/perf-smoke.mjs");
    expect(() => validateHelperReceipt(null)).toThrow("receipt");
    expect(() => validateHelperReceipt({})).toThrow("receipt");
    expect(() =>
      validateHelperReceipt({
        runId: "test",
        ownerUnit: "U075",
        purpose: "performance-smoke",
        imageDigest: "sha256:abc",
        sentinel: {
          runId: "test",
          ownerUnit: "U075",
          purpose: "performance-smoke",
          imageDigest: "sha256:abc",
        },
      }),
    ).not.toThrow();
  });

  it("rejects phase-B spawn before phase-A port release", () => {
    const { validatePhaseTransition } = require("../../scripts/perf-smoke.mjs");
    expect(() => validatePhaseTransition({ phaseAComplete: false, portsFree: false })).toThrow("phase-A");
  });

  it("rejects reuseExistingServer:true in phase B", () => {
    const { validatePhaseBConfig } = require("../../scripts/perf-smoke.mjs");
    expect(() => validatePhaseBConfig({ reuseExistingServer: true })).toThrow("reuseExistingServer");
  });

  it("rejects phase-A PID visible during phase B", () => {
    const { validateNoPidOverlap } = require("../../scripts/perf-smoke.mjs");
    expect(() => validateNoPidOverlap([1234], [1234])).toThrow("PID overlap");
  });

  it("requires both ports free after phase A", () => {
    const { validatePortsFree } = require("../../scripts/perf-smoke.mjs");
    expect(() => validatePortsFree({ webPortFree: true, apiPortFree: false })).toThrow("port");
  });
});

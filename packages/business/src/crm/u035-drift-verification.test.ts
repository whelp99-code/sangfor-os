import { resolve, join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

// @ts-expect-error -- U009's lifecycle helper is a committed plain-JS module.
import { withIsolatedPostgres } from "../../../../scripts/lib/isolated-postgres.mjs";

const integration = process.env.CI_INTEGRATION === "1";
const IMAGE_DIGEST = "sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777";
const REPO_ROOT = resolve(import.meta.dirname, "../../../..");
const SCRATCH_DIR = join(
  REPO_ROOT,
  ".omo/evidence/sangfor-system-refactor-2026-07-15/U047/attempt-1/quote-scratch"
);

describe.skipIf(!integration)("U035 Database Authority Drift Verification", () => {
  let dbUrl: string;
  let lifecycle: Promise<void> | null = null;
  let releaseLifecycle: (() => void) | null = null;

  beforeAll(async () => {
    let resolveReady: ((ctx: { databaseUrl: string }) => void) | undefined;
    const ready = new Promise<{ databaseUrl: string }>((res) => {
      resolveReady = res;
    });

    const held = new Promise<void>((res) => {
      releaseLifecycle = res;
    });

    lifecycle = withIsolatedPostgres(
      {
        runId: `u047-drift-${Date.now().toString(36)}`,
        ownerUnit: "U047",
        purpose: "u047-drift-verification",
        evidenceDir: SCRATCH_DIR,
        imageDigest: IMAGE_DIGEST,
        migrate: true,
        applicationRoleMode: "required",
      },
      async (ctx: { databaseUrl: string }) => {
        resolveReady?.(ctx);
        await held;
      }
    );

    const ctx = await ready;
    dbUrl = ctx.databaseUrl;
  }, 120000);

  afterAll(async () => {
    releaseLifecycle?.();
    await lifecycle;
  });

  it("verifies 5 exact U035 triggers and FK RESTRICT constraint without modification", async () => {
    const client = new PrismaClient({ datasources: { db: { url: dbUrl } } });
    try {
      const triggers = await client.$queryRaw<Array<{ tgname: string; relname: string }>>`
        SELECT t.tgname, c.relname
        FROM pg_trigger t
        JOIN pg_class c ON c.oid = t.tgrelid
        WHERE t.tgname IN (
          'quotes_canonical_immutable_update_trg',
          'quotes_canonical_immutable_delete_trg',
          'quote_commercial_snapshots_immutable_update_trg',
          'quote_commercial_snapshots_immutable_delete_trg',
          'quote_line_fulfillment_v1_validate_trg'
        )
        AND NOT t.tgisinternal;
      `;

      expect(triggers.length).toBe(5);

      const triggerNames = triggers.map((t) => t.tgname).sort();
      expect(triggerNames).toEqual([
        "quote_commercial_snapshots_immutable_delete_trg",
        "quote_commercial_snapshots_immutable_update_trg",
        "quote_line_fulfillment_v1_validate_trg",
        "quotes_canonical_immutable_delete_trg",
        "quotes_canonical_immutable_update_trg",
      ]);

      const constraints = await client.$queryRaw<Array<{ conname: string; confdeltype: string }>>`
        SELECT c.conname, c.confdeltype
        FROM pg_constraint c
        JOIN pg_class cl ON cl.oid = c.conrelid
        WHERE cl.relname = 'quote_commercial_snapshots'
        AND c.conname = 'quote_commercial_snapshots_quote_id_fkey';
      `;

      expect(constraints.length).toBe(1);
      expect(constraints[0].confdeltype).toBe("r");
    } finally {
      await client.$disconnect();
    }
  });
});

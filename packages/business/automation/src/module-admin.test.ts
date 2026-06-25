import { config as loadEnv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prisma } from "@ai-portal/db";
import { describe, expect, it } from "vitest";

import { setModuleRegistryStatus, toggleModuleRegistryStatus } from "./module-admin";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../",
);
loadEnv({ path: path.join(repoRoot, ".env") });

const integrationEnabled = process.env.CI_INTEGRATION === "1";
const dbIntegrationEnabled =
  integrationEnabled && Boolean(process.env.DATABASE_URL?.trim());

describe.skipIf(!dbIntegrationEnabled)("module admin side effects", () => {
  it("toggle changes registry status only and keeps blocks/nodes", async () => {
    const target = await prisma.moduleRegistry.findFirst({
      where: { status: { in: ["active", "disabled"] } },
      orderBy: { moduleKey: "asc" },
      select: { moduleKey: true, status: true },
    });
    expect(target?.moduleKey).toBeTruthy();
    const moduleKey = target!.moduleKey;
    const originalStatus = target!.status as "active" | "disabled";
    const expectedStatus = originalStatus === "active" ? "disabled" : "active";

    const [beforeBlocks, beforeNodes] = await Promise.all([
      prisma.blockRegistry.count({ where: { moduleKey } }),
      prisma.nodeRegistry.count({ where: { moduleKey } }),
    ]);

    try {
      const toggled = await toggleModuleRegistryStatus(moduleKey, "operator");
      expect(toggled.status).toBe(expectedStatus);

      const [afterBlocks, afterNodes] = await Promise.all([
        prisma.blockRegistry.count({ where: { moduleKey } }),
        prisma.nodeRegistry.count({ where: { moduleKey } }),
      ]);

      expect(afterBlocks).toBe(beforeBlocks);
      expect(afterNodes).toBe(beforeNodes);
    } finally {
      await setModuleRegistryStatus({
        moduleKey,
        status: originalStatus,
        actorType: "operator",
      });
    }
  }, 30_000);

  it("writes state transition and audit entries", async () => {
    const target = await prisma.moduleRegistry.findFirst({
      where: { status: { in: ["active", "disabled"] } },
      orderBy: { moduleKey: "asc" },
      select: { moduleKey: true, status: true },
    });
    const moduleKey = target!.moduleKey;
    const originalStatus = target!.status as "active" | "disabled";
    const nextStatus = originalStatus === "active" ? "disabled" : "active";

    const [beforeTransitions, beforeAudits] = await Promise.all([
      prisma.stateTransitionLog.count({
        where: {
          entityType: "module",
          entityId: moduleKey,
          fromStatus: originalStatus,
          toStatus: nextStatus,
        },
      }),
      prisma.auditLog.count({
        where: {
          action: "set_module_registry_status",
        },
      }),
    ]);

    try {
      await setModuleRegistryStatus({
        moduleKey,
        status: nextStatus,
        actorType: "operator",
      });
      const [afterTransitions, afterAudits] = await Promise.all([
        prisma.stateTransitionLog.count({
          where: {
            entityType: "module",
            entityId: moduleKey,
            fromStatus: originalStatus,
            toStatus: nextStatus,
          },
        }),
        prisma.auditLog.count({
          where: {
            action: "set_module_registry_status",
          },
        }),
      ]);

      expect(afterTransitions).toBeGreaterThan(beforeTransitions);
      expect(afterAudits).toBeGreaterThan(beforeAudits);
    } finally {
      await setModuleRegistryStatus({
        moduleKey,
        status: originalStatus,
        actorType: "operator",
      });
    }
  }, 30_000);
});

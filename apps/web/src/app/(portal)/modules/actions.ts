"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@sangfor/db";
import { recordAuditEvent } from "@sangfor/business";
import { toggleModuleRegistryStatus } from "@sangfor/business/module-admin";

import { listSkillCatalog } from "@sangfor/business/skills";

export async function getModulesData() {
  const [modules, blocks, layoutSlots, nodes, connectors, recentRun] = await Promise.all([
    prisma.moduleRegistry.findMany({ orderBy: { moduleKey: "asc" } }),
    prisma.blockRegistry.findMany({ orderBy: { blockKey: "asc" } }),
    prisma.layoutSlot.findMany({ include: { block: true } }),
    prisma.nodeRegistry.findMany({ orderBy: { nodeKey: "asc" } }),
    prisma.connectorRegistry.findMany({ orderBy: { connectorKey: "asc" } }),
    prisma.commandRun.findFirst({
      orderBy: { createdAt: "desc" },
      select: { id: true }
    })
  ]);

  const skills = listSkillCatalog();

  const configuredMap = {
    github: !!process.env.GITHUB_TOKEN,
    slack: !!process.env.SLACK_WEBHOOK_URL,
    outlook: !!process.env.OUTLOOK_API_KEY,
  };

  const recentTraceId = recentRun?.id || null;

  return { modules, blocks, layoutSlots, nodes, connectors, skills, configuredMap, recentTraceId };
}

export async function toggleModuleStatus(moduleKey: string, currentStatus: string) {
  const updated = await toggleModuleRegistryStatus(moduleKey, "operator");
  const expectedStatus = currentStatus === "active" ? "disabled" : "active";
  if (updated.status !== expectedStatus) {
    throw new Error("module_toggle_state_mismatch");
  }

  revalidatePath("/modules");
  return updated;
}

export async function toggleConnectorCredentialMode(connectorKey: string, currentMode: string) {
  let newMode = "mock";
  if (currentMode === "mock") {
    newMode = "read_only";
  } else if (currentMode === "read_only") {
    newMode = "real";
  } else {
    newMode = "mock";
  }
  
  // Upsert connector registry status to newMode
  const updated = await prisma.connectorRegistry.upsert({
    where: { connectorKey },
    update: { status: newMode },
    create: {
      connectorKey,
      displayName: connectorKey.charAt(0).toUpperCase() + connectorKey.slice(1),
      connectorType: connectorKey === "github" ? "vcs" : connectorKey === "slack" ? "im" : "email",
      status: newMode,
    },
  });

  await recordAuditEvent("connector_credential_toggle", "system", "connector", connectorKey, {
    fromMode: currentMode,
    toMode: newMode,
  });

  revalidatePath("/modules");
  return updated;
}

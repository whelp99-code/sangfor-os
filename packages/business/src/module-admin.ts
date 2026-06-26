import { prisma } from "@sangfor/db";

import { logStateTransition } from "./audit";
import { recordAuditEvent } from "./audit-db";

export async function setModuleRegistryStatus(input: {
  moduleKey: string;
  status: "active" | "disabled";
  actorType?: "operator" | "engine" | "user";
}) {
  const actorType = input.actorType ?? "operator";
  const existing = await prisma.moduleRegistry.findUniqueOrThrow({
    where: { moduleKey: input.moduleKey },
  });

  if (existing.status === input.status) {
    return existing;
  }

  const updated = await prisma.moduleRegistry.update({
    where: { moduleKey: input.moduleKey },
    data: { status: input.status },
  });

  await logStateTransition({
    entityType: "module",
    entityId: input.moduleKey,
    fromStatus: existing.status,
    toStatus: input.status,
    actorType,
  });

  await recordAuditEvent(
    "set_module_registry_status",
    actorType,
    "module_registry",
    input.moduleKey,
    {
      moduleKey: input.moduleKey,
      fromStatus: existing.status,
      toStatus: input.status,
    },
  );

  return updated;
}

export async function toggleModuleRegistryStatus(
  moduleKey: string,
  actorType: "operator" | "engine" | "user" = "operator",
) {
  const existing = await prisma.moduleRegistry.findUniqueOrThrow({
    where: { moduleKey },
    select: { status: true },
  });
  const nextStatus = existing.status === "active" ? "disabled" : "active";
  return setModuleRegistryStatus({
    moduleKey,
    status: nextStatus,
    actorType,
  });
}

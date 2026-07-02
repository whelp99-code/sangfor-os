import { prisma } from "@sangfor/db";

export interface ModuleDependencyStatus {
  dependencyStatusByKey: Record<string, string | undefined>;
  connectorStatusByKey: Record<string, string | null>;
}

/**
 * Resolve current module/connector registry status, used as the dependency
 * baseline for module runtime validation.
 * Extracted from apps/web route to decouple presentation from persistence.
 */
export async function resolveModuleDependencyStatus(): Promise<ModuleDependencyStatus> {
  const [modules, connectors] = await Promise.all([
    prisma.moduleRegistry.findMany({
      select: { moduleKey: true, status: true },
    }),
    prisma.connectorRegistry.findMany({
      select: { connectorKey: true, status: true },
    }),
  ]);

  const dependencyStatusByKey = Object.fromEntries(
    modules.map((module) => [module.moduleKey, module.status]),
  ) as Record<string, string | undefined>;

  const connectorStatusByKey = Object.fromEntries(
    connectors.map((connector) => [connector.connectorKey, connector.status]),
  ) as Record<string, string | null>;

  return { dependencyStatusByKey, connectorStatusByKey };
}

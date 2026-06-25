import { prisma, type Prisma } from "@ai-portal/db";
import { z } from "zod";
import {
  FORBIDDEN_ACTION_KEYS,
  listActionDefinitions,
  resolveConnectorRuntimeState,
} from "./action-connector-runtime";

/**
 * Activepieces-inspired (MIT/community portion) manifest style:
 * - small typed manifest
 * - deterministic validation path
 * This implementation is original and intentionally minimal for AIOS runtime.
 */
export const moduleManifestSchema = z.object({
  moduleKey: z.string().min(2).max(64),
  displayName: z.string().min(2).max(120),
  version: z.string().regex(/^\d+\.\d+\.\d+(-[\w.-]+)?$/),
  status: z.enum(["active", "experimental", "deprecated", "disabled"]).default("active"),
  description: z.string().max(1000).optional(),
  dependencyKeys: z.array(z.string().min(1)).default([]),
  blocks: z
    .array(
      z.object({
        blockKey: z.string().min(2),
        displayName: z.string().min(2),
        queryKey: z.string().optional(),
      }),
    )
    .default([]),
  nodes: z
    .array(
      z.object({
        nodeKey: z.string().min(2),
        nodeType: z.string().min(1),
      }),
    )
    .default([]),
  attribution: z
    .object({
      inspiredBy: z.literal("activepieces-community-manifest-pattern"),
      sourceLicense: z.literal("MIT-compatible pattern only"),
      notes: z.string().min(1),
    })
    .default({
      inspiredBy: "activepieces-community-manifest-pattern",
      sourceLicense: "MIT-compatible pattern only",
      notes: "No AGPL/SUL/source-available code copied.",
    }),
});

export type ModuleManifest = z.infer<typeof moduleManifestSchema>;

export type ModuleManifestValidation = {
  valid: boolean;
  errors: string[];
  manifest: ModuleManifest | null;
};

export type ModuleValidationIssueCode =
  | "missing_dependency"
  | "disabled_dependency"
  | "forbidden_action"
  | "missing_credential"
  | "route_smoke_target_missing";

export type ModuleValidationIssue = {
  code: ModuleValidationIssueCode;
  message: string;
  dependencyKey?: string;
  actionKey?: string;
  connectorKey?: string;
};

export type ModuleValidationRuntimeInput = {
  dependencyStatusByKey: Record<string, string | undefined>;
  actionKeys: string[];
  routeSmokeTargets: string[];
  connectorStatusByKey?: Record<string, string | null>;
};

export type ModuleValidationRuntimeResult = {
  valid: boolean;
  errors: string[];
  warnings: string[];
  issues: ModuleValidationIssue[];
};

type ModuleRegistryRow = {
  moduleKey: string;
  displayName: string;
  version: string;
  status: string;
  dependencyJson: Prisma.JsonValue | null;
};

type BlockRegistryRow = {
  blockKey: string;
  displayName: string;
  configJson: Prisma.JsonValue | null;
};

type NodeRegistryRow = {
  nodeKey: string;
  nodeType: string;
};

function parseDependencyKeys(value: Prisma.JsonValue | null): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
}

function parseQueryKey(value: Prisma.JsonValue | null): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const queryKey = (value as Record<string, unknown>).queryKey;
  return typeof queryKey === "string" && queryKey.length > 0 ? queryKey : undefined;
}

export function convertRegistryRowsToManifest(input: {
  module: ModuleRegistryRow;
  blocks: BlockRegistryRow[];
  nodes: NodeRegistryRow[];
}): ModuleManifest {
  const status = ["active", "experimental", "deprecated", "disabled"].includes(input.module.status)
    ? (input.module.status as "active" | "experimental" | "deprecated" | "disabled")
    : "experimental";

  return moduleManifestSchema.parse({
    moduleKey: input.module.moduleKey,
    displayName: input.module.displayName,
    version: input.module.version,
    status,
    dependencyKeys: parseDependencyKeys(input.module.dependencyJson),
    blocks: input.blocks.map((block) => ({
      blockKey: block.blockKey,
      displayName: block.displayName,
      queryKey: parseQueryKey(block.configJson),
    })),
    nodes: input.nodes.map((node) => ({
      nodeKey: node.nodeKey,
      nodeType: node.nodeType,
    })),
  });
}

export function convertManifestToRegistryPatch(manifest: ModuleManifest) {
  return {
    module: {
      moduleKey: manifest.moduleKey,
      displayName: manifest.displayName,
      version: manifest.version,
      status: manifest.status,
      dependencyJson: manifest.dependencyKeys,
    },
    blocks: manifest.blocks.map((block) => ({
      blockKey: block.blockKey,
      moduleKey: manifest.moduleKey,
      displayName: block.displayName,
      configJson: block.queryKey ? { queryKey: block.queryKey } : null,
    })),
    nodes: manifest.nodes.map((node) => ({
      nodeKey: node.nodeKey,
      moduleKey: manifest.moduleKey,
      nodeType: node.nodeType,
      configJson: null,
    })),
  };
}

export function validateModuleManifest(input: unknown): ModuleManifestValidation {
  const parsed = moduleManifestSchema.safeParse(input);
  if (parsed.success) {
    return { valid: true, errors: [], manifest: parsed.data };
  }
  return {
    valid: false,
    errors: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
    manifest: null,
  };
}

export function validateModuleRuntime(
  moduleManifest: ModuleManifest,
  runtime: ModuleValidationRuntimeInput,
): ModuleValidationRuntimeResult {
  const issues: ModuleValidationIssue[] = [];
  const warnings: string[] = [];

  for (const depKey of moduleManifest.dependencyKeys) {
    const depStatus = runtime.dependencyStatusByKey[depKey];
    if (!depStatus) {
      issues.push({
        code: "missing_dependency",
        dependencyKey: depKey,
        message: `Missing dependency module: ${depKey}`,
      });
      continue;
    }
    if (depStatus === "disabled") {
      issues.push({
        code: "disabled_dependency",
        dependencyKey: depKey,
        message: `Dependency module is disabled: ${depKey}`,
      });
    }
  }

  for (const actionKey of runtime.actionKeys) {
    if (FORBIDDEN_ACTION_KEYS.has(actionKey)) {
      issues.push({
        code: "forbidden_action",
        actionKey,
        message: `Forbidden action is not allowed: ${actionKey}`,
      });
    }
  }

  const connectorKeys = [...new Set(
    listActionDefinitions({ moduleKey: moduleManifest.moduleKey }).map((action) => action.connectorKey),
  )];

  for (const connectorKey of connectorKeys) {
    const connectorState = resolveConnectorRuntimeState(connectorKey, {
      registryStatus: runtime.connectorStatusByKey?.[connectorKey] ?? null,
    });
    if (!connectorState) continue;

    if (!connectorState.credentialsPresent) {
      const missingCredentialIssue: ModuleValidationIssue = {
        code: "missing_credential",
        connectorKey,
        message: `Connector credentials missing for ${connectorKey}; mode=${connectorState.effectiveMode}`,
      };
      if (connectorState.effectiveMode === "real" || connectorState.effectiveMode === "read_only") {
        issues.push(missingCredentialIssue);
      } else {
        warnings.push(missingCredentialIssue.message);
      }
    }
  }

  if (runtime.routeSmokeTargets.length === 0) {
    issues.push({
      code: "route_smoke_target_missing",
      message: "At least one route-smoke target is required for module validation.",
    });
  }

  return {
    valid: issues.length === 0,
    errors: issues.map((issue) => issue.message),
    warnings,
    issues,
  };
}

export async function listModuleManifests(): Promise<ModuleManifest[]> {
  const modules = await prisma.moduleRegistry.findMany({
    orderBy: { moduleKey: "asc" },
    include: {
      blocks: { orderBy: { blockKey: "asc" } },
      nodes: { orderBy: { nodeKey: "asc" } },
    },
  });
  return modules.map((module) =>
    convertRegistryRowsToManifest({
      module: {
        moduleKey: module.moduleKey,
        displayName: module.displayName,
        version: module.version,
        status: module.status,
        dependencyJson: module.dependencyJson,
      },
      blocks: module.blocks.map((block) => ({
        blockKey: block.blockKey,
        displayName: block.displayName,
        configJson: block.configJson,
      })),
      nodes: module.nodes.map((node) => ({
        nodeKey: node.nodeKey,
        nodeType: node.nodeType,
      })),
    }),
  );
}

export async function getModuleManifest(moduleKey: string): Promise<ModuleManifest | null> {
  const module = await prisma.moduleRegistry.findUnique({
    where: { moduleKey },
    include: {
      blocks: { orderBy: { blockKey: "asc" } },
      nodes: { orderBy: { nodeKey: "asc" } },
    },
  });
  if (!module) return null;
  return convertRegistryRowsToManifest({
    module: {
      moduleKey: module.moduleKey,
      displayName: module.displayName,
      version: module.version,
      status: module.status,
      dependencyJson: module.dependencyJson,
    },
    blocks: module.blocks.map((block) => ({
      blockKey: block.blockKey,
      displayName: block.displayName,
      configJson: block.configJson,
    })),
    nodes: module.nodes.map((node) => ({
      nodeKey: node.nodeKey,
      nodeType: node.nodeType,
    })),
  });
}

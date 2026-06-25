import { prisma } from "@sangfor/db";
import { z } from "zod";
import { traceWorkflowEvent } from "./langfuse-observability";

/**
 * AIOS action + connector metadata runtime (original implementation).
 * Exposes executable action metadata and credential state without running side effects.
 */

export const credentialModeSchema = z.enum(["mock", "real", "read_only"]);
export type CredentialMode = z.infer<typeof credentialModeSchema>;

export const actionRiskSchema = z.enum(["low", "medium", "high"]);
export type ActionRisk = z.infer<typeof actionRiskSchema>;

export const actionCapabilitySchema = z.enum(["read", "sync", "workflow", "write"]);
export type ActionCapability = z.infer<typeof actionCapabilitySchema>;

export const actionDefinitionSchema = z.object({
  actionKey: z.string().min(2).max(96),
  displayName: z.string().min(2).max(120),
  description: z.string().max(500).optional(),
  moduleKey: z.string().min(2).max(64),
  connectorKey: z.string().min(2).max(64),
  risk: actionRiskSchema,
  capabilities: z.array(actionCapabilitySchema).min(1),
  removable: z.boolean().default(true),
});

export type ActionDefinition = z.infer<typeof actionDefinitionSchema>;

export const connectorDefinitionSchema = z.object({
  connectorKey: z.string().min(2).max(64),
  displayName: z.string().min(2).max(120),
  description: z.string().max(500).optional(),
  connectorType: z.enum(["vcs", "mail", "workflow", "internal"]),
  allowedModes: z.array(credentialModeSchema).min(1),
  mockSafe: z.boolean().default(true),
  envKeys: z.array(z.string()).default([]),
  defaultMode: credentialModeSchema,
  maxMode: credentialModeSchema,
});

export type ConnectorDefinition = z.infer<typeof connectorDefinitionSchema>;

export type ConnectorRuntimeState = ConnectorDefinition & {
  effectiveMode: CredentialMode;
  realCapable: boolean;
  credentialsPresent: boolean;
  warnings: string[];
  registryStatus: string | null;
};

export type ActionValidationResult = {
  valid: boolean;
  actionKey: string;
  errors: string[];
  warnings: string[];
  action: ActionDefinition | null;
  connector: ConnectorRuntimeState | null;
};

/** Explicitly rejected — never registered or executable via this runtime. */
export const FORBIDDEN_ACTION_KEYS = new Set([
  "mail.oauth",
  "mail.graph",
  "mail.send",
  "mail.delete",
  "mail.move",
]);

const WRITE_BLOCKED_CAPABILITIES = new Set<ActionCapability>(["write", "sync"]);

const CONNECTOR_DEFINITIONS: ConnectorDefinition[] = [
  {
    connectorKey: "github",
    displayName: "GitHub",
    description: "VCS connector; token-backed when GITHUB_TOKEN is set.",
    connectorType: "vcs",
    allowedModes: ["mock", "real", "read_only"],
    mockSafe: true,
    envKeys: ["GITHUB_TOKEN"],
    defaultMode: "mock",
    maxMode: "real",
  },
  {
    connectorKey: "mail-intelligence",
    displayName: "Mail Intelligence",
    description: "Read-only mail adapter; no OAuth/Graph/send/delete/move.",
    connectorType: "mail",
    allowedModes: ["mock", "read_only"],
    mockSafe: true,
    envKeys: [],
    defaultMode: "read_only",
    maxMode: "read_only",
  },
  {
    connectorKey: "phase13",
    displayName: "Phase 13 Orchestrator",
    description: "Internal PM skills / orchestrator workflow.",
    connectorType: "internal",
    allowedModes: ["mock"],
    mockSafe: true,
    envKeys: [],
    defaultMode: "mock",
    maxMode: "mock",
  },
  {
    connectorKey: "phase15",
    displayName: "Phase 15 Improvement Loop",
    description: "Internal error-to-improvement workflow.",
    connectorType: "internal",
    allowedModes: ["mock"],
    mockSafe: true,
    envKeys: [],
    defaultMode: "mock",
    maxMode: "mock",
  },
];

const ACTION_DEFINITIONS: ActionDefinition[] = [
  {
    actionKey: "github.sync-pr",
    displayName: "Sync GitHub PR",
    description: "Sync pull request metadata via GitHub connector (mock-safe without token).",
    moduleKey: "development",
    connectorKey: "github",
    risk: "medium",
    capabilities: ["sync"],
    removable: true,
  },
  {
    actionKey: "phase13.run",
    displayName: "Run Phase 13 Orchestrator",
    description: "Start Phase 13 PM skills orchestrator workflow.",
    moduleKey: "development",
    connectorKey: "phase13",
    risk: "medium",
    capabilities: ["workflow"],
    removable: true,
  },
  {
    actionKey: "phase15.convert-to-phase13",
    displayName: "Convert improvement to Phase 13",
    description: "Convert approved improvement into Phase 13 orchestrator input.",
    moduleKey: "development",
    connectorKey: "phase15",
    risk: "low",
    capabilities: ["workflow"],
    removable: true,
  },
  {
    actionKey: "mail.read",
    displayName: "Read mail (adapter)",
    description: "Read-only mail intelligence access; no send/move/delete.",
    moduleKey: "mail-intelligence",
    connectorKey: "mail-intelligence",
    risk: "low",
    capabilities: ["read"],
    removable: true,
  },
];

function connectorDefinitionMap(): Map<string, ConnectorDefinition> {
  return new Map(CONNECTOR_DEFINITIONS.map((c) => [c.connectorKey, c]));
}

export function isForbiddenActionKey(actionKey: string): boolean {
  return FORBIDDEN_ACTION_KEYS.has(actionKey);
}

export function listActionDefinitions(filter?: { moduleKey?: string }): ActionDefinition[] {
  let actions = ACTION_DEFINITIONS.filter((a) => !isForbiddenActionKey(a.actionKey));
  if (filter?.moduleKey) {
    actions = actions.filter((a) => a.moduleKey === filter.moduleKey);
  }
  return actions;
}

export function getActionDefinition(actionKey: string): ActionDefinition | null {
  if (isForbiddenActionKey(actionKey)) return null;
  return ACTION_DEFINITIONS.find((a) => a.actionKey === actionKey) ?? null;
}

export function listConnectorDefinitions(): ConnectorDefinition[] {
  return [...CONNECTOR_DEFINITIONS];
}

export function getConnectorDefinition(connectorKey: string): ConnectorDefinition | null {
  return CONNECTOR_DEFINITIONS.find((c) => c.connectorKey === connectorKey) ?? null;
}

function credentialsPresentForConnector(defn: ConnectorDefinition): boolean {
  if (defn.envKeys.length === 0) return defn.connectorType === "internal";
  return defn.envKeys.some((key) => {
    const value = process.env[key];
    return typeof value === "string" && value.trim().length > 0;
  });
}

function stagingMode(): string {
  return (process.env.CONNECTOR_STAGING_MODE ?? "mock").toLowerCase();
}

function modeFromRegistryStatus(status: string | null | undefined): CredentialMode | null {
  if (!status) return null;
  const normalized = status.toLowerCase();
  if (normalized === "mock" || normalized === "real" || normalized === "read_only") {
    return normalized;
  }
  if (normalized === "active" || normalized === "disabled") return null;
  return null;
}

export function resolveConnectorRuntimeState(
  connectorKey: string,
  options?: { registryStatus?: string | null },
): ConnectorRuntimeState | null {
  const defn = getConnectorDefinition(connectorKey);
  if (!defn) return null;

  const warnings: string[] = [];
  const credentialsPresent = credentialsPresentForConnector(defn);
  const registryMode = modeFromRegistryStatus(options?.registryStatus);
  const staging = stagingMode();

  let effectiveMode: CredentialMode = defn.defaultMode;
  let realCapable = false;

  if (defn.connectorType === "internal") {
    effectiveMode = "mock";
    if (!credentialsPresent) {
      warnings.push(`${defn.connectorKey}: internal workflow; no external credentials required.`);
    }
  } else if (defn.connectorKey === "mail-intelligence") {
    effectiveMode = credentialsPresent ? "read_only" : "mock";
    if (!credentialsPresent) {
      warnings.push("mail-intelligence: credentials absent; using mock/read_only-safe metadata only.");
    } else {
      warnings.push("mail-intelligence: read_only cap enforced; OAuth/Graph/send/delete/move are forbidden.");
    }
  } else if (defn.connectorKey === "github") {
    if (!credentialsPresent) {
      effectiveMode = "mock";
      warnings.push("GITHUB_TOKEN not set; github connector stays mock-safe.");
    } else if (staging === "real" && registryMode !== "read_only") {
      effectiveMode = registryMode === "mock" ? "mock" : "real";
      realCapable = effectiveMode === "real";
      warnings.push("GITHUB_TOKEN present; real-capable metadata only (no destructive execution).");
    } else {
      effectiveMode = registryMode ?? "mock";
      if (staging !== "real") {
        warnings.push(`CONNECTOR_STAGING_MODE=${staging}; github metadata capped at mock.`);
      }
      if (registryMode === "read_only") {
        warnings.push("github connector registry mode is read_only.");
      }
    }
  }

  if (registryMode && defn.allowedModes.includes(registryMode)) {
    effectiveMode = clampMode(effectiveMode, registryMode, defn.maxMode);
  }

  effectiveMode = clampMode(effectiveMode, effectiveMode, defn.maxMode);

  if (effectiveMode === "real" && !credentialsPresent) {
    effectiveMode = "mock";
    warnings.push(`${connectorKey}: real mode requested but credentials missing; downgraded to mock.`);
    realCapable = false;
  }

  return {
    ...defn,
    effectiveMode,
    realCapable,
    credentialsPresent,
    warnings,
    registryStatus: options?.registryStatus ?? null,
  };
}

function clampMode(current: CredentialMode, preferred: CredentialMode, max: CredentialMode): CredentialMode {
  const order: CredentialMode[] = ["mock", "read_only", "real"];
  const maxIdx = order.indexOf(max);
  const pick = order[Math.min(order.indexOf(preferred), maxIdx)] ?? current;
  return order[Math.min(order.indexOf(pick), maxIdx)] ?? current;
}

export function validateActionDefinition(input: unknown): {
  valid: boolean;
  errors: string[];
  action: ActionDefinition | null;
} {
  const parsed = actionDefinitionSchema.safeParse(input);
  if (parsed.success) {
    if (isForbiddenActionKey(parsed.data.actionKey)) {
      return {
        valid: false,
        errors: ["action_forbidden"],
        action: null,
      };
    }
    return { valid: true, errors: [], action: parsed.data };
  }
  return {
    valid: false,
    errors: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    action: null,
  };
}

export function validateAction(
  actionKey: string,
  options?: { registryStatusByConnector?: Record<string, string | null> },
): ActionValidationResult {
  const finalize = (result: ActionValidationResult): ActionValidationResult => {
    void traceWorkflowEvent({
      event: "actionRuntime.validation",
      phase: 13,
      actionKey: result.actionKey,
      actionValidationResult: {
        valid: result.valid,
        errors: result.errors,
        warnings: result.warnings,
        connectorMode: result.connector?.effectiveMode ?? null,
      },
      metadata: {
        connectorKey: result.connector?.connectorKey ?? null,
      },
    });
    return result;
  };

  if (isForbiddenActionKey(actionKey)) {
    return finalize({
      valid: false,
      actionKey,
      errors: ["action_forbidden"],
      warnings: ["Mail OAuth/Graph/send/delete/move actions are not supported."],
      action: null,
      connector: null,
    });
  }

  const action = getActionDefinition(actionKey);
  if (!action) {
    return finalize({
      valid: false,
      actionKey,
      errors: ["action_not_found"],
      warnings: [],
      action: null,
      connector: null,
    });
  }

  const schemaCheck = validateActionDefinition(action);
  if (!schemaCheck.valid) {
    return finalize({
      valid: false,
      actionKey,
      errors: schemaCheck.errors,
      warnings: [],
      action: null,
      connector: null,
    });
  }

  const registryStatus =
    options?.registryStatusByConnector?.[action.connectorKey] ?? null;
  const connector = resolveConnectorRuntimeState(action.connectorKey, { registryStatus });
  if (!connector) {
    return finalize({
      valid: false,
      actionKey,
      errors: ["connector_not_found"],
      warnings: [],
      action,
      connector: null,
    });
  }

  const errors: string[] = [];
  const warnings = [...connector.warnings];

  if (
    connector.effectiveMode === "read_only" &&
    action.capabilities.some((cap) => WRITE_BLOCKED_CAPABILITIES.has(cap))
  ) {
    errors.push("read_only_connector_blocks_action");
  }

  if (connector.effectiveMode === "mock" && stagingMode() === "mock") {
    warnings.push(`Action ${actionKey} validated in mock mode (CI-safe).`);
  }

  return finalize({
    valid: errors.length === 0,
    actionKey,
    errors,
    warnings,
    action,
    connector,
  });
}

export function countActionsForModule(moduleKey: string): number {
  return listActionDefinitions({ moduleKey }).length;
}

export function moduleActionConnectorLinks(moduleKey: string) {
  return {
    actions: `/api/actions?moduleKey=${encodeURIComponent(moduleKey)}`,
    connectors: "/api/connectors",
  };
}

export async function listConnectorRuntimeStates(): Promise<ConnectorRuntimeState[]> {
  let registryRows: { connectorKey: string; status: string }[] = [];
  try {
    registryRows = await prisma.connectorRegistry.findMany({
      select: { connectorKey: true, status: true },
      orderBy: { connectorKey: "asc" },
    });
  } catch {
    registryRows = [];
  }

  const statusByKey = new Map(registryRows.map((r) => [r.connectorKey, r.status]));

  return CONNECTOR_DEFINITIONS.map((defn) =>
    resolveConnectorRuntimeState(defn.connectorKey, {
      registryStatus: statusByKey.get(defn.connectorKey) ?? null,
    }),
  ).filter((state): state is ConnectorRuntimeState => state !== null);
}

export async function enrichModuleWithActionConnectorMetadata<T extends { moduleKey: string }>(
  module: T,
): Promise<
  T & {
    actionCount: number;
    connectorKeys: string[];
    links: ReturnType<typeof moduleActionConnectorLinks>;
  }
> {
  const actions = listActionDefinitions({ moduleKey: module.moduleKey });
  const connectorKeys = [...new Set(actions.map((a) => a.connectorKey))].sort();
  return {
    ...module,
    actionCount: actions.length,
    connectorKeys,
    links: moduleActionConnectorLinks(module.moduleKey),
  };
}

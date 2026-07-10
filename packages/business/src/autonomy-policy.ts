import { prisma } from "@sangfor/db";

export type AutonomyMode = "observe" | "suggest" | "auto";

export type AutonomyPolicyRow = {
  mode: string;
  minAutonomy: number;
  minSamples: number;
  requireColorGatePass: boolean;
};

export type ResolveAutonomyInput = {
  domain: string;
  decisionType: string;
  autonomy: { score: number; samples: number } | null;
  colorGatePass: boolean | null;
};

export type ResolveAutonomyDeps = {
  loadPolicy?: (
    domain: string,
    decisionType: string,
  ) => Promise<AutonomyPolicyRow | null>;
  env?: Record<string, string | undefined>;
  /**
   * Optional DB-backed kill-switch check (see `isAutopilotEnabled`). When
   * omitted, only the env hard-off is honored — this is legacy behavior
   * preserved so existing callers (e.g. autopilot.ts) are unaffected until
   * they explicitly opt into the DB-backed toggle by passing this dep.
   */
  checkAutopilotEnabled?: (deps?: AutopilotConfigDeps) => Promise<boolean>;
};

export async function resolveAutonomyMode(
  input: ResolveAutonomyInput,
  deps?: ResolveAutonomyDeps,
): Promise<AutonomyMode> {
  const env = deps?.env ?? process.env;
  const autopilot = env.AUTOPILOT_ENABLED;
  if (autopilot === "0" || autopilot === "false") {
    return "observe";
  }

  if (deps?.checkAutopilotEnabled) {
    const enabled = await deps.checkAutopilotEnabled({ env });
    if (!enabled) return "observe";
  }

  const policy: AutonomyPolicyRow | null = deps?.loadPolicy
    ? await deps.loadPolicy(input.domain, input.decisionType)
    : await (async () => {
        const row = await prisma.autonomyPolicy.findUnique({
          where: {
            domain_decisionType: {
              domain: input.domain,
              decisionType: input.decisionType,
            },
          },
        });
        if (!row) return null;
        return {
          mode: row.mode,
          minAutonomy: row.minAutonomy,
          minSamples: row.minSamples,
          requireColorGatePass: row.requireColorGatePass,
        };
      })();

  if (!policy) return "observe";

  if (policy.mode === "observe") return "observe";
  if (policy.mode === "suggest") return "suggest";

  if (policy.mode === "auto") {
    if (
      input.autonomy != null &&
      input.autonomy.score >= policy.minAutonomy &&
      input.autonomy.samples >= policy.minSamples &&
      (policy.requireColorGatePass ? input.colorGatePass === true : true)
    ) {
      return "auto";
    }
    // Degrade to suggest when auto conditions aren't met —
    // observe would be overly conservative for a policy that explicitly opted into auto.
    return "suggest";
  }

  // Unknown mode: fail-safe — an unrecognized mode must never grant elevated autonomy.
  return "observe";
}

export function autonomyFromComputed(a: {
  pct: number | null;
  sample: number;
}): { score: number; samples: number } | null {
  if (a.pct === null) return null;
  return { score: a.pct / 100, samples: a.sample };
}

// ── DB-backed autopilot kill-switch (config_profiles/config_values, same
// store llm-settings.ts uses) ───────────────────────────────────────────────

const AUTOPILOT_CONFIG_PROFILE_KEY = "autopilot";
const AUTOPILOT_CONFIG_VALUE_KEY = "AUTOPILOT_ENABLED";
const AUTOPILOT_CACHE_TTL_MS = 30_000;

export type AutopilotConfigDeps = {
  env?: Record<string, string | undefined>;
  readConfigValue?: () => Promise<boolean | null>;
  now?: () => number;
};

let autopilotEnabledCache: { value: boolean; expiresAt: number } | null = null;

async function readAutopilotConfigFromDb(): Promise<boolean | null> {
  const profile = await prisma.configProfile.findUnique({
    where: { key: AUTOPILOT_CONFIG_PROFILE_KEY },
    select: {
      values: { where: { key: AUTOPILOT_CONFIG_VALUE_KEY }, select: { valueJson: true } },
    },
  });
  const raw = profile?.values[0]?.valueJson;
  return typeof raw === "boolean" ? raw : null;
}

export async function isAutopilotEnabled(deps?: AutopilotConfigDeps): Promise<boolean> {
  const env = deps?.env ?? process.env;
  const flag = env.AUTOPILOT_ENABLED;
  if (flag === "0" || flag === "false") return false;

  const now = deps?.now ?? Date.now;
  const nowMs = now();
  if (autopilotEnabledCache && autopilotEnabledCache.expiresAt > nowMs) {
    return autopilotEnabledCache.value;
  }

  const reader = deps?.readConfigValue ?? readAutopilotConfigFromDb;
  let stored: boolean | null;
  try {
    stored = await reader();
  } catch (error) {
    console.error("[isAutopilotEnabled] DB read failed, failing closed:", error);
    autopilotEnabledCache = { value: false, expiresAt: nowMs + AUTOPILOT_CACHE_TTL_MS };
    return false;
  }

  const enabled = stored === null ? true : stored;
  autopilotEnabledCache = { value: enabled, expiresAt: nowMs + AUTOPILOT_CACHE_TTL_MS };
  return enabled;
}

export function __resetAutopilotEnabledCacheForTests(): void {
  autopilotEnabledCache = null;
}

export async function setAutopilotEnabled(
  enabled: boolean,
  deps?: { prisma?: typeof prisma },
): Promise<void> {
  const client = deps?.prisma ?? prisma;
  const profile = await client.configProfile.upsert({
    where: { key: AUTOPILOT_CONFIG_PROFILE_KEY },
    update: {},
    create: { key: AUTOPILOT_CONFIG_PROFILE_KEY },
  });
  await client.configValue.upsert({
    where: { profileId_key: { profileId: profile.id, key: AUTOPILOT_CONFIG_VALUE_KEY } },
    update: { valueJson: enabled },
    create: { profileId: profile.id, key: AUTOPILOT_CONFIG_VALUE_KEY, valueJson: enabled },
  });
  autopilotEnabledCache = { value: enabled, expiresAt: Date.now() + AUTOPILOT_CACHE_TTL_MS };
}

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

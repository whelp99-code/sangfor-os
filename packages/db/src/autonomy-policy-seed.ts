export const AUTOPILOT_APPROVAL_DECISION_TYPE = "autopilot_approve";

export const AUTOPILOT_POLICY_DOMAINS = [
  "marketing",
  "sales",
  "sales_support",
  "presales",
  "engineer",
  "cfo",
] as const;

type AutonomyPolicySeedStore = {
  readonly upsert: (args: {
    readonly where: {
      readonly domain_decisionType: {
        readonly domain: string;
        readonly decisionType: string;
      };
    };
    readonly update: Record<string, never>;
    readonly create: {
      readonly domain: string;
      readonly decisionType: string;
      readonly mode: "observe";
    };
  }) => Promise<unknown>;
};

export async function seedAutopilotPolicies(
  store: AutonomyPolicySeedStore,
): Promise<number> {
  for (const domain of AUTOPILOT_POLICY_DOMAINS) {
    await store.upsert({
      where: {
        domain_decisionType: {
          domain,
          decisionType: AUTOPILOT_APPROVAL_DECISION_TYPE,
        },
      },
      update: {},
      create: {
        domain,
        decisionType: AUTOPILOT_APPROVAL_DECISION_TYPE,
        mode: "observe",
      },
    });
  }
  return AUTOPILOT_POLICY_DOMAINS.length;
}

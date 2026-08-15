import { describe, expect, it } from "vitest";

import {
  AUTOPILOT_APPROVAL_DECISION_TYPE,
  AUTOPILOT_POLICY_DOMAINS,
  seedAutopilotPolicies,
} from "./autonomy-policy-seed";

describe("seedAutopilotPolicies", () => {
  it("uses the runtime autopilot approval decision key for every domain", async () => {
    // Given
    const calls: unknown[] = [];
    const store = {
      upsert: async (args: unknown) => {
        calls.push(args);
      },
    };

    // When
    const seeded = await seedAutopilotPolicies(store);

    // Then
    expect(AUTOPILOT_APPROVAL_DECISION_TYPE).toBe("autopilot_approve");
    expect(seeded).toBe(AUTOPILOT_POLICY_DOMAINS.length);
    expect(calls).toHaveLength(AUTOPILOT_POLICY_DOMAINS.length);
    expect(calls).toEqual(
      AUTOPILOT_POLICY_DOMAINS.map((domain) => ({
        where: {
          domain_decisionType: {
            domain,
            decisionType: "autopilot_approve",
          },
        },
        update: {},
        create: {
          domain,
          decisionType: "autopilot_approve",
          mode: "observe",
        },
      })),
    );
  });
});

import { describe, expect, it } from "vitest";

import {
  WORKFLOW_DEFINITION_HASH_VERSION,
  WorkflowRuntimeError,
  assertWorkflowDefinitionEnvelope,
} from "./workflow-contracts";

describe("canonical workflow definition contracts", () => {
  it("accepts only the U017 artifact-content RFC8785 envelope/hash version", () => {
    expect(WORKFLOW_DEFINITION_HASH_VERSION).toBe("artifact-content/rfc8785-jcs-sha256/v1");
    expect(() => assertWorkflowDefinitionEnvelope({ contentHashVersion: "other", canonicalContentEnvelope: "{}", contentHash: "a".repeat(64) })).toThrow(
      WorkflowRuntimeError,
    );
    expect(() => assertWorkflowDefinitionEnvelope({ contentHashVersion: WORKFLOW_DEFINITION_HASH_VERSION, canonicalContentEnvelope: "{\"not\":\"the-envelope\"}", contentHash: "a".repeat(64), contentJson: { steps: [] } })).toThrow(
      WorkflowRuntimeError,
    );
  });
});

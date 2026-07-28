import { describe, expect, it } from "vitest";

import * as approvalDb from "./approval-db";
import * as approvalGate from "./approval-gate";

describe("U048 submitCommercialApproval removal verification", () => {
  it("approval-db no longer exports submitCommercialApproval", () => {
    expect("submitCommercialApproval" in approvalDb).toBe(false);
  });

  it("approval-gate no longer re-exports submitCommercialApproval", () => {
    expect("submitCommercialApproval" in approvalGate).toBe(false);
  });

  it("approval-db no longer exports CommercialApprovalInput interface", () => {
    expect("CommercialApprovalInput" in approvalDb).toBe(false);
  });

  it("legacy ensureApprovalForRun/createApprovalIfNeeded/approveRequest remain available", () => {
    expect(typeof approvalDb.ensureApprovalForRun).toBe("function");
    expect(typeof approvalDb.createApprovalIfNeeded).toBe("function");
    expect(typeof approvalDb.approveRequest).toBe("function");
  });

  it("canonical createCanonicalApprovalRequest remains available", () => {
    expect(typeof approvalDb.createCanonicalApprovalRequest).toBe("function");
  });
});

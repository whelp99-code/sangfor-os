import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { OwnershipTransferPanel } from "./ownership-transfer-panel";

const BASE_PROPS = {
  roleChangeRequestId: "rcr1",
  transferRequired: false,
  itemCount: 0,
  tuples: [],
  previewHash: "a".repeat(64),
  previewSchemaVersion: "ownership-transfer/v1",
  membershipRevision: 0,
  approvalRequestRevision: 0,
  successorEligibility: "not_required",
};

describe("OwnershipTransferPanel", () => {
  it("renders no-transfer badge when itemCount=0", () => {
    const html = renderToStaticMarkup(createElement(OwnershipTransferPanel, BASE_PROPS));
    expect(html).toContain("transfer-not-required");
    expect(html).toContain("zero owned resources");
  });

  it("renders transfer-required state with inventory table", () => {
    const html = renderToStaticMarkup(createElement(OwnershipTransferPanel, {
      ...BASE_PROPS,
      transferRequired: true,
      itemCount: 2,
      successorEligibility: "required",
      tuples: [
        { entityType: "Artifact", entityId: "art1", ownerAssignmentId: "src1", ownershipRevision: 0 },
        { entityType: "Opportunity", entityId: "opp1", ownerAssignmentId: "src1", ownershipRevision: 1 },
      ],
    }));
    expect(html).toContain("transfer-required");
    expect(html).toContain("2 resource(s)");
    expect(html).toContain("Artifact");
    expect(html).toContain("Opportunity");
  });
});

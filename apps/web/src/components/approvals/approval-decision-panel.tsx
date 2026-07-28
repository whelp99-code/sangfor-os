import React from "react";

interface Props {
  approvalId: string;
  revision: number;
  enabled: boolean;
  onDecide?: (decision: "approve" | "reject", reason?: string) => void;
}

export function ApprovalDecisionPanel({ approvalId, revision, enabled, onDecide }: Props) {
  if (!enabled) {
    return (
      <div className="decision-panel-disabled" data-testid="decision-panel-disabled">
        <p className="status-notice">Decision controls disabled — request is stale, decided, or unassigned.</p>
      </div>
    );
  }

  return (
    <div className="decision-panel" data-testid="decision-panel">
      <h3>Submit Decision</h3>
      <button className="btn-approve" onClick={() => onDecide?.("approve")}>Approve</button>
      <button className="btn-reject" onClick={() => onDecide?.("reject")}>Reject</button>
    </div>
  );
}

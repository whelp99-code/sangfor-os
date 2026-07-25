import React from "react";
import { SyntheticDrillPanel } from "@/components/operator/synthetic-drill-panel";

export default function OperatorWorkflowsPage() {
  return (
    <div className="operator-workflows-page space-y-6 p-6">
      <h1>Operator Workflows Workspace</h1>
      <p>Canonical system_admin surface for workflow definitions, runs, and blocker management.</p>
      <SyntheticDrillPanel />
    </div>
  );
}

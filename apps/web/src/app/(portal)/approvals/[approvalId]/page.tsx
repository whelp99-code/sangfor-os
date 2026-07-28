import React from "react";

export default async function ApprovalDetailPage({ params }: { params: Promise<{ approvalId: string }> }) {
  const { approvalId } = await params;
  return (
    <div className="approval-detail-page">
      <h1>Approval Detail: {approvalId}</h1>
      <p>Approval Request detail view with server-computed version diffs.</p>
    </div>
  );
}

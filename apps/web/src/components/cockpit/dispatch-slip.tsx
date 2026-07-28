import React from "react";

interface Props {
  header: string;
  draft: string;
  verification?: React.ReactNode;
  decision?: React.ReactNode;
}

export function DispatchSlip({ header, draft, verification, decision }: Props) {
  return (
    <div
      className="dispatch-slip border rounded p-4 space-y-3 bg-white"
      data-design-component="DispatchSlip"
    >
      <div className="text-sm font-bold border-b pb-2">{header}</div>
      <div className="text-xs text-gray-600 bg-gray-50 p-2 rounded">{draft}</div>
      {verification && <div className="verification-slot">{verification}</div>}
      {decision && <div className="decision-slot pt-2">{decision}</div>}
    </div>
  );
}

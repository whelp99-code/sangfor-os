import React from "react";

export type CandidateColorGate = "B" | "R" | "O" | "G" | "T";

interface Props {
  gate: CandidateColorGate;
  level?: "통과" | "대기" | "보류";
  sentence?: string;
}

export function VerificationConsole({ gate, level = "통과", sentence = "자동화 검증 조건 충족" }: Props) {
  return (
    <div
      className="verification-console border rounded p-3 my-2"
      data-design-component="VerificationConsole"
      data-design-semantic="ai-validation"
    >
      <div className="flex items-center gap-2 mb-1">
        <span className="font-mono font-bold px-2 py-0.5 rounded text-xs bg-blue-100 text-blue-900 border border-blue-300">
          [{gate}]
        </span>
        <span className="text-xs font-semibold">{level}</span>
      </div>
      <p className="text-xs text-gray-700">{sentence}</p>
    </div>
  );
}

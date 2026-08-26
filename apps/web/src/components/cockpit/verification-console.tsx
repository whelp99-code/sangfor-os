import React from "react";

type CandidateColorGate = "B" | "R" | "O" | "G" | "T";

const CHANNELS: readonly { code: CandidateColorGate; color: string }[] = [
  { code: "B", color: "var(--ck-blue)" },
  { code: "R", color: "var(--ck-red)" },
  { code: "O", color: "var(--ck-orange)" },
  { code: "G", color: "var(--ck-gray)" },
  { code: "T", color: "var(--ck-teal)" },
];

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
      <div className="mb-1 flex items-center gap-2" role="group" aria-label={`검증 채널 ${gate}`}>
        <span className="flex gap-1" aria-hidden="true">
          {CHANNELS.map((channel) => (
            <span
              key={channel.code}
              className="inline-flex size-6 items-center justify-center rounded text-xs font-bold text-white"
              style={{ backgroundColor: channel.color, opacity: channel.code === gate ? 1 : 0.35 }}
            >
              {channel.code}
            </span>
          ))}
        </span>
        <span className="text-xs font-semibold">{level}</span>
      </div>
      <p className="text-xs text-gray-700">{sentence}</p>
    </div>
  );
}

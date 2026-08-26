import React from "react";

type AICode = "MK" | "SA" | "PS" | "EN" | "CF";

interface Props {
  code: AICode;
  label: string;
}

export function RoleAIBadge({ code, label }: Props) {
  return (
    <span
      className="role-ai-badge inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs bg-slate-100 text-slate-800 border"
      data-design-component="RoleAIBadge"
    >
      <span className="font-mono font-bold text-slate-900">{code}</span>
      <span>{label}</span>
    </span>
  );
}

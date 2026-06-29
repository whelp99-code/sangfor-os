import type { ReactNode } from "react";
import { CFO } from "@/lib/cfo-theme";

/**
 * CFO 페이지 공용 머스트헤드 — "잉크 위 장부(ledger)" 시그니처.
 * ink 제목 + 짧은 brass 룰. 어떤 레이아웃(단독/flex)에도 끼울 수 있게 컴팩트하게.
 */
export function CfoPageHeading({ title, right }: { title: string; right?: ReactNode }) {
  return (
    <div style={{ color: CFO.ink }}>
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {right}
      </div>
      <div className="mt-1 h-0.5 w-12" style={{ background: CFO.brass }} />
    </div>
  );
}

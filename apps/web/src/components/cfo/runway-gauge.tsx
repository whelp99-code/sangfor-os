// Signature element of the CFO console: a "cash runway" fuel gauge.
// Reads as a ledger instrument — months of cash on a 0–12 scale, sign-aware.
import { CFO } from "@/lib/cfo-theme";

const SCALE = 12; // months shown end-to-end
const TICKS = [0, 3, 6, 9, 12];

export function RunwayGauge({ months, currentCash }: { months: number | null; currentCash: number }) {
  const m = months ?? 0;
  const pct = Math.max(0, Math.min(1, m / SCALE));
  const fill = m < 3 ? CFO.outflow : m < 6 ? CFO.brass : CFO.inflow;

  return (
    <section
      className="rounded-2xl p-6"
      style={{ background: CFO.ink, color: CFO.paper }}
    >
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.18em]" style={{ color: CFO.brass }}>
            현금 런웨이
          </p>
          <p className="mt-1 font-mono tabular-nums text-5xl font-semibold leading-none">
            {months != null ? months.toFixed(1) : "—"}
            <span className="ml-2 text-lg font-normal" style={{ color: "rgba(251,250,248,0.6)" }}>
              개월
            </span>
          </p>
          {months == null && (
            <p className="mt-1.5 text-xs" style={{ color: "rgba(251,250,248,0.55)" }}>
              산정 불가 — 이번 달 지출 기준
            </p>
          )}
        </div>
        <div className="text-right">
          <p className="text-xs" style={{ color: "rgba(251,250,248,0.55)" }}>현재 현금</p>
          <p className="mt-0.5 font-mono tabular-nums text-2xl">₩{Math.round(currentCash).toLocaleString("ko-KR")}</p>
        </div>
      </div>

      {/* gauge track */}
      <div className="mt-6">
        <div className="relative h-3 w-full overflow-hidden rounded-full" style={{ background: "rgba(251,250,248,0.12)" }}>
          <div className="h-full rounded-full transition-all" style={{ width: `${pct * 100}%`, background: fill }} />
          {/* danger threshold at 3 months */}
          <div className="absolute top-0 h-full w-px" style={{ left: `${(3 / SCALE) * 100}%`, background: "rgba(251,250,248,0.35)" }} />
        </div>
        <div className="mt-1.5 flex justify-between font-mono text-[10px]" style={{ color: "rgba(251,250,248,0.45)" }}>
          {TICKS.map((t) => (
            <span key={t}>{t}{t === SCALE ? "+" : ""}</span>
          ))}
        </div>
      </div>
    </section>
  );
}

/**
 * DealStageGuide — "이 단계 가이드" panel (mockup 02 § .guide / .checks).
 *
 * Renders the current stage's exit criterion and a checklist of deliverables.
 * Entirely presentational — checkboxes are advisory (unchecked by default).
 */

import { stageDisplay } from "@/components/deals/stage-meta";
import { STAGE_GUIDE } from "@/components/deals/stage-guide-data";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type DealStageGuideProps = {
  /** Raw opportunity stage enum string (e.g. "PROPOSAL", "POC"). */
  stage: string;
  className?: string;
};

export function DealStageGuide({ stage, className }: DealStageGuideProps) {
  const { idx } = stageDisplay(stage);
  const guide = STAGE_GUIDE[idx];

  // Graceful fallback when the stage has no guide entry yet.
  if (!guide) return null;

  return (
    <section
      className={cn("rounded-lg border bg-card pb-4", className)}
      aria-label="이 단계 가이드"
    >
      {/* ── Header row: tag + exit criterion + advisory CTA ────────────────── */}
      <div className="flex flex-wrap items-center gap-3 px-4 pt-4 pb-3">
        {/* Stage tag badge — primary/10 bg to echo mockup azure→primary */}
        <span
          className="rounded bg-primary/10 px-2 py-0.5 text-[11px] font-bold text-primary"
          aria-label="단계 태그"
        >
          {guide.tag}
        </span>

        {/* Exit criterion — muted text, bolded portion highlighted in emerald */}
        <p className="flex-1 text-xs text-muted-foreground">
          통과 기준 —{" "}
          <strong className="font-semibold text-success">
            {guide.exit}
          </strong>
        </p>

        {/* Presentational "단계 완료" button (no action, advisory CTA) */}
        <Button
          size="sm"
          className="shrink-0 text-xs"
          aria-label="단계 완료 표시 (참고용)"
          type="button"
        >
          단계 완료 ✓
        </Button>
      </div>

      {/* ── Deliverable checklist (2-col, all unchecked / advisory) ────────── */}
      <ul
        className="grid grid-cols-1 gap-x-6 gap-y-2 px-4 sm:grid-cols-2"
        role="list"
        aria-label="이 단계 인도물 체크리스트"
      >
        {guide.deliverables.map((item) => (
          <li key={item} className="flex items-center gap-2.5">
            {/* Advisory unchecked checkbox visual (purely decorative) */}
            <span
              className="size-[15px] shrink-0 rounded-sm border-[1.5px] border-muted-foreground/40"
              aria-hidden="true"
            />
            <span className="text-xs text-foreground">{item}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

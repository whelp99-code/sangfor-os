/**
 * DealAiRail — right-rail "AI 거들기" panel (mockup 02 § .rail / .ai / .sugg).
 *
 * Purely presentational — all AI suggestion cards and buttons are advisory only.
 * No backend integration; no real AI calls.
 */

import { stageDisplay } from "@/components/deals/stage-meta";
import { STAGE_GUIDE } from "@/components/deals/stage-guide-data";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type DealAiRailProps = {
  /** Raw opportunity stage enum string (e.g. "PROPOSAL", "POC"). */
  stage: string;
  className?: string;
};

export function DealAiRail({ stage, className }: DealAiRailProps) {
  const { idx } = stageDisplay(stage);
  const guide = STAGE_GUIDE[idx];
  const suggestions = guide?.ai ?? [];

  return (
    <aside className={cn("flex flex-col gap-3", className)} aria-label="AI 거들기 레일">
      {/* ── AI suggestion panel ─────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex flex-wrap items-baseline gap-1.5 text-sm text-primary">
            <span aria-hidden="true">✦</span>
            <span>AI 거들기</span>
            <span className="text-xs font-normal text-muted-foreground">
              — 제안만, 결정은 내가
            </span>
          </CardTitle>
        </CardHeader>

        <CardContent className="space-y-3">
          {suggestions.length === 0 ? (
            <p className="text-xs text-muted-foreground">이 단계의 AI 제안이 없습니다.</p>
          ) : (
            suggestions.map((text) => (
              <div
                key={text}
                className="rounded-lg border bg-primary/5 px-3 py-2.5"
              >
                <p className="mb-2 text-xs font-semibold text-foreground">{text}</p>
                <div className="flex gap-1.5">
                  <Button
                    size="sm"
                    className="h-7 px-2.5 text-[11px]"
                    aria-label={`수락: ${text}`}
                    type="button"
                  >
                    수락
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-2.5 text-[11px]"
                    aria-label={`나중에: ${text}`}
                    type="button"
                  >
                    나중에
                  </Button>
                </div>
              </div>
            ))
          )}

          {/* Disclaimer note */}
          <p className="text-center text-[11px] text-muted-foreground">
            AI는 초안·자료만 제시합니다. 본문은 당신이 씁니다.
          </p>
        </CardContent>
      </Card>

      {/* ── 활동 panel — simple static activity list ──────────────────────── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-1.5 text-sm">
            <span aria-hidden="true">🕑</span>
            <span>활동 타임라인</span>
          </CardTitle>
        </CardHeader>

        <CardContent>
          <ul className="space-y-0 divide-y divide-border" aria-label="활동 목록">
            <li className="flex gap-2.5 py-2">
              <span
                className="mt-1 size-2 shrink-0 rounded-full bg-primary"
                aria-hidden="true"
              />
              <div>
                <p className="text-xs font-semibold">단계 진행 중</p>
                <p className="text-[11px] text-muted-foreground">현재 단계 작업 목록을 확인하세요</p>
              </div>
            </li>
          </ul>
        </CardContent>
      </Card>
    </aside>
  );
}

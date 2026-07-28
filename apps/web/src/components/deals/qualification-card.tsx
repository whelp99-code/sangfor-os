"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export type QualificationData = {
  id?: string;
  budgetScore?: number | null;
  authorityScore?: number | null;
  needScore?: number | null;
  timelineScore?: number | null;
  technicalFitScore?: number | null;
  scoreTotal?: number | null;
  passed?: boolean | null;
  scoringVersion?: string | null;
  revision?: number | null;
  assessedAt?: string | null;
  notes?: string | null;
};

export type QualificationCardProps = {
  opportunityId: string;
  qualification?: QualificationData | null;
  readOnly?: boolean;
  onSaveSuccess?: () => void;
};

export function QualificationCard({
  opportunityId,
  qualification,
  readOnly = false,
  onSaveSuccess,
}: QualificationCardProps) {
  const isPassing = qualification?.scoringVersion === "bant-tf-v1" && qualification?.passed === true;
  const isStale = qualification && qualification.scoringVersion !== "bant-tf-v1";

  const [isEditing, setIsEditing] = useState(false);
  const [budgetScore, setBudgetScore] = useState(qualification?.budgetScore ?? 0);
  const [authorityScore, setAuthorityScore] = useState(qualification?.authorityScore ?? 0);
  const [needScore, setNeedScore] = useState(qualification?.needScore ?? 0);
  const [timelineScore, setTimelineScore] = useState(qualification?.timelineScore ?? 0);
  const [technicalFitScore, setTechnicalFitScore] = useState(qualification?.technicalFitScore ?? 0);
  const [notes, setNotes] = useState(qualification?.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const calculatedTotal = budgetScore + authorityScore + needScore + timelineScore + technicalFitScore;
  const currentRevision = qualification?.revision ?? 0;

  async function handleSave() {
    setSaving(true);
    setErrorMsg(null);

    try {
      const res = await fetch(`/api/opportunities/${opportunityId}/qualification`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "idempotency-key": `qual-save-${Date.now()}`,
        },
        body: JSON.stringify({
          expectedRevision: currentRevision,
          budgetScore,
          authorityScore,
          needScore,
          timelineScore,
          technicalFitScore,
          notes: notes.trim() || null,
        }),
      });

      if (res.status === 409) {
        setErrorMsg("다른 사용자가 이미 자격 판정을 갱신했습니다 (409 Conflict). 현재 입력을 유지하며 최신 데이터를 확인하세요.");
        return;
      }

      if (!res.ok) {
        const data = await res.json();
        setErrorMsg(data.error || "자격 판정 저장에 실패했습니다.");
        return;
      }

      setIsEditing(false);
      onSaveSuccess?.();
    } catch (err: any) {
      setErrorMsg(err?.message || "저장 중 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="rounded-md border border-border shadow-sm">
      <CardHeader className="p-4 border-b border-border flex flex-row items-center justify-between">
        <div className="flex items-center gap-2">
          <CardTitle className="text-sm font-semibold">BANT + Technical Fit 자격 평가</CardTitle>
          <span
            className={`text-xs px-2 py-0.5 rounded font-medium ${
              isPassing
                ? "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300"
                : "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
            }`}
          >
            {isPassing ? "QUALIFIED (통과)" : "NEEDS DISCOVERY (미통과)"}
          </span>
          {isStale && (
            <span className="text-xs px-2 py-0.5 rounded bg-rose-100 text-rose-800 font-medium">
              레거시 revision (재평가 필요)
            </span>
          )}
        </div>
        {!readOnly && !isEditing && (
          <Button size="sm" variant="outline" onClick={() => setIsEditing(true)}>
            평가 수정
          </Button>
        )}
      </CardHeader>
      <CardContent className="p-4 space-y-4 text-xs">
        {errorMsg && (
          <div className="p-2.5 rounded bg-rose-50 border border-rose-200 text-rose-700 dark:bg-rose-950 dark:border-rose-900 dark:text-rose-200 font-mono">
            {errorMsg}
          </div>
        )}

        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <div className="p-2.5 rounded border border-border bg-muted/30">
            <div className="text-muted-foreground mb-1">Budget (예산)</div>
            {isEditing ? (
              <Input
                type="number"
                min={0}
                max={20}
                value={budgetScore}
                onChange={(e) => setBudgetScore(Number(e.target.value))}
                className="h-7 text-xs"
              />
            ) : (
              <div className="font-semibold">{qualification?.budgetScore ?? 0} / 20</div>
            )}
          </div>

          <div className="p-2.5 rounded border border-border bg-muted/30">
            <div className="text-muted-foreground mb-1">Authority (의사결정)</div>
            {isEditing ? (
              <Input
                type="number"
                min={0}
                max={20}
                value={authorityScore}
                onChange={(e) => setAuthorityScore(Number(e.target.value))}
                className="h-7 text-xs"
              />
            ) : (
              <div className="font-semibold">{qualification?.authorityScore ?? 0} / 20</div>
            )}
          </div>

          <div className="p-2.5 rounded border border-border bg-muted/30">
            <div className="text-muted-foreground mb-1">Need (필요성)</div>
            {isEditing ? (
              <Input
                type="number"
                min={0}
                max={24}
                value={needScore}
                onChange={(e) => setNeedScore(Number(e.target.value))}
                className="h-7 text-xs"
              />
            ) : (
              <div className="font-semibold">{qualification?.needScore ?? 0} / 24</div>
            )}
          </div>

          <div className="p-2.5 rounded border border-border bg-muted/30">
            <div className="text-muted-foreground mb-1">Timeline (일정)</div>
            {isEditing ? (
              <Input
                type="number"
                min={0}
                max={16}
                value={timelineScore}
                onChange={(e) => setTimelineScore(Number(e.target.value))}
                className="h-7 text-xs"
              />
            ) : (
              <div className="font-semibold">{qualification?.timelineScore ?? 0} / 16</div>
            )}
          </div>

          <div className="p-2.5 rounded border border-border bg-muted/30">
            <div className="text-muted-foreground mb-1">Technical Fit (기술적합)</div>
            {isEditing ? (
              <Input
                type="number"
                min={0}
                max={20}
                value={technicalFitScore}
                onChange={(e) => setTechnicalFitScore(Number(e.target.value))}
                className="h-7 text-xs"
              />
            ) : (
              <div className="font-semibold">{qualification?.technicalFitScore ?? 0} / 20</div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-border pt-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-sm">
                총점: {isEditing ? calculatedTotal : qualification?.scoreTotal ?? 0} / 100
              </span>
              <span className="text-muted-foreground">(기준: 60점 이상)</span>
            </div>
            <div className="text-muted-foreground text-[11px] flex items-center gap-3">
              <span>버전: {qualification?.scoringVersion ?? "bant-tf-v1"}</span>
              <span>Revision: {qualification?.revision ?? 0}</span>
              {qualification?.assessedAt && (
                <span>평가시각: {new Date(qualification.assessedAt).toLocaleString()}</span>
              )}
            </div>
          </div>

          {isEditing && (
            <div className="flex items-center gap-2">
              <Button size="sm" variant="ghost" onClick={() => setIsEditing(false)} disabled={saving}>
                취소
              </Button>
              <Button size="sm" onClick={handleSave} disabled={saving}>
                {saving ? "저장 중..." : "저장"}
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

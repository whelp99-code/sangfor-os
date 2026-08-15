"use client";

import { useState } from "react";

import { actionErrorMessage } from "@/lib/action-error-labels";
import { Button } from "@/components/ui/button";

import { normalizeOpportunityStage } from "@sangfor/business/opportunity-stage";

export function AdvanceOpportunityButton({
  id,
  stage,
  expectedUpdatedAt,
  qualificationPassed,
}: {
  id: string;
  stage: string;
  expectedUpdatedAt: string;
  qualificationPassed: boolean;
}) {
  const canonical = normalizeOpportunityStage(stage);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const prerequisiteMessage =
    canonical === "LEAD" && !qualificationPassed
      ? "BANT 자격검증을 먼저 통과해야 합니다."
      : null;

  if (canonical === "WON" || canonical === "LOST") return null;

  async function advance() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/opportunities/${id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({ action: "advance", expectedUpdatedAt }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(actionErrorMessage((data as { error?: string }).error, "단계를 변경하지 못했습니다."));
        return;
      }
      window.location.reload();
    } catch {
      setError("단계를 변경하지 못했습니다. 네트워크를 확인해 주세요.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-1">
      <Button size="sm" onClick={advance} disabled={loading || prerequisiteMessage !== null}>
        {loading ? "진행 중..." : "다음 단계로"}
      </Button>
      {prerequisiteMessage && (
        <p className="max-w-48 text-right text-xs text-muted-foreground">
          {prerequisiteMessage}
        </p>
      )}
      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

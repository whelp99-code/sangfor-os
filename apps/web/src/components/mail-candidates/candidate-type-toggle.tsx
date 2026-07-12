"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { actionErrorMessage } from "@/lib/action-error-labels";

type CorrectableType = "customer" | "partner";

const TARGET_LABEL: Record<CorrectableType, string> = {
  customer: "고객",
  partner: "파트너",
};

export function CandidateTypeToggle({
  candidateId,
  candidateType,
}: {
  candidateId: string;
  candidateType: CorrectableType;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const target: CorrectableType = candidateType === "customer" ? "partner" : "customer";

  async function correct() {
    setLoading(true);
    setError(null);
    const res = await fetch(`/api/mail-candidates/${candidateId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "set_candidate_type", candidateType: target }),
    });
    if (res.ok) {
      router.refresh();
    } else {
      const data = await res.json().catch(() => ({}));
      setError(actionErrorMessage(data.error, actionErrorMessage("patch_failed")));
    }
    setLoading(false);
  }

  return (
    <span className="inline-flex items-center gap-2">
      <Button size="sm" variant="outline" disabled={loading} onClick={correct} type="button">
        {loading ? "전환 중…" : `${TARGET_LABEL[target]}로 전환`}
      </Button>
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </span>
  );
}

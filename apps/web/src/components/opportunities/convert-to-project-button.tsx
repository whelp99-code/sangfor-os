"use client";

import { useState } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { actionErrorMessage } from "@/lib/action-error-labels";

export function ConvertToProjectButton({
  id,
  expectedUpdatedAt,
  engagementId,
}: {
  id: string;
  expectedUpdatedAt: string;
  engagementId?: string | null;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (engagementId) {
    return (
      <Link
        href={`/projects/${engagementId}`}
        className="text-sm font-medium text-primary underline-offset-2 hover:underline"
      >
        프로젝트 보기 →
      </Link>
    );
  }

  async function convert() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/opportunities/${id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({ action: "convert_to_project", expectedUpdatedAt }),
      });
      const data = await res.json();
      if (!res.ok) {
        const code = typeof data.error === "string" ? data.error : null;
        setError(actionErrorMessage(code, "프로젝트 전환에 실패했습니다."));
        return;
      }
      window.location.href = `/projects/${data.engagement.id}`;
    } catch {
      setError("전환 요청 실패");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button size="sm" onClick={convert} disabled={busy}>
        {busy ? "전환 중…" : "프로젝트로 전환"}
      </Button>
      {error && (
        <div className="text-right text-xs text-red-600">
          {error}
        </div>
      )}
    </div>
  );
}

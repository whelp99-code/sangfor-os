"use client";

import { useState } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { actionErrorMessage } from "@/lib/action-error-labels";

export function ConvertToProjectButton({
  id,
  engagementId,
}: {
  id: string;
  engagementId?: string | null;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);

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

  async function convert(force: boolean) {
    setBusy(true);
    setError(null);
    setErrorCode(null);
    try {
      const res = await fetch(`/api/opportunities/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "convert_to_project", force }),
      });
      const data = await res.json();
      if (!res.ok) {
        const code = typeof data.error === "string" ? data.error : null;
        setErrorCode(code);
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

  function confirmForcedConversion() {
    const approved = window.confirm(
      "확정된 POC 없이 프로젝트로 강제 전환할까요? 전환 후에는 별도 프로젝트 기록이 생성됩니다.",
    );
    if (approved) void convert(true);
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button size="sm" onClick={() => convert(false)} disabled={busy}>
        {busy ? "전환 중…" : "프로젝트로 전환"}
      </Button>
      {error && (
        <div className="text-right text-xs text-red-600">
          {error}
          {errorCode === "conversion_requires_poc" && (
            <button
              type="button"
              onClick={confirmForcedConversion}
              className="ml-1 underline"
              disabled={busy}
            >
              무시하고 전환
            </button>
          )}
        </div>
      )}
    </div>
  );
}

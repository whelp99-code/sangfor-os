"use client";

import { useState } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";

export function ConvertToProjectButton({
  id,
  engagementId,
}: {
  id: string;
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

  async function convert(force: boolean) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/opportunities/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "convert_to_project", force }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "전환 실패");
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
      <Button size="sm" onClick={() => convert(false)} disabled={busy}>
        {busy ? "전환 중…" : "프로젝트로 전환"}
      </Button>
      {error && (
        <div className="text-right text-xs text-red-600">
          {error}
          {error.includes("POC") && (
            <button
              type="button"
              onClick={() => convert(true)}
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

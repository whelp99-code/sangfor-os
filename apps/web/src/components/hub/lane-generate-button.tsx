"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function LaneGenerateButton({ projectId, domain }: { projectId: string; domain: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleGenerate() {
    setLoading(true);
    setError(null);
    setSuccess(false);
    try {
      const res = await fetch(`/api/projects/${projectId}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain }),
      });
      const data = await res.json();
      if (data.error) {
        setError(data.error);
      } else {
        setSuccess(true);
        router.refresh();
        setTimeout(() => setSuccess(false), 3000);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "오류");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center gap-2 mt-2">
      <button
        type="button"
        onClick={handleGenerate}
        disabled={loading}
        className="rounded border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50"
      >
        {loading ? "생성 중..." : "AI 생성"}
      </button>
      {success && <span className="text-xs text-green-600">생성됨</span>}
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}

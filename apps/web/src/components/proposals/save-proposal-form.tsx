"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { actionErrorMessage } from "@/lib/action-error-labels";
import { Button } from "@/components/ui/button";

export function SaveProposalForm({
  documentId,
  initialBody,
}: {
  documentId: string;
  initialBody: string;
}) {
  const router = useRouter();
  const [bodyMarkdown, setBodyMarkdown] = useState(initialBody);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/proposals/${documentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bodyMarkdown }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(actionErrorMessage((data as { error?: string }).error, "버전을 저장하지 못했습니다."));
        return;
      }
      router.refresh();
    } catch {
      setError("버전을 저장하지 못했습니다. 네트워크를 확인해 주세요.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="space-y-3" onSubmit={onSubmit}>
      <textarea
        className="min-h-[320px] w-full rounded-md border bg-background px-3 py-2 font-mono text-sm"
        value={bodyMarkdown}
        onChange={(e) => setBodyMarkdown(e.target.value)}
      />
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      <Button type="submit" disabled={loading}>
        {loading ? "버전 저장 중..." : "새 버전 저장"}
      </Button>
    </form>
  );
}

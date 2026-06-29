"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function LaneDecisionControls({ projectId, domain }: { projectId: string; domain: string }) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCorrect, setShowCorrect] = useState(false);
  const [note, setNote] = useState("");

  async function post(body: Record<string, unknown>) {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/domain-decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      router.refresh();
      setStatus("기록됨");
      setTimeout(() => setStatus(null), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "오류 발생");
    } finally {
      setSubmitting(false);
    }
  }

  function handleApprove() {
    post({ domain, outcome: "approved" });
  }

  function handleReject() {
    post({ domain, outcome: "rejected" });
  }

  function handleCorrectSubmit() {
    post({ domain, outcome: "corrected", note, humanEdit: { note } });
    setShowCorrect(false);
    setNote("");
  }

  function handleCorrectCancel() {
    setShowCorrect(false);
    setNote("");
  }

  return (
    <div className="mt-3 space-y-2">
      <div className="flex items-center gap-2">
        <button
          className="rounded border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50"
          disabled={submitting}
          onClick={handleApprove}
        >
          승인
        </button>
        <button
          className="rounded border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50"
          disabled={submitting}
          onClick={() => setShowCorrect(true)}
        >
          수정
        </button>
        <button
          className="rounded border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50"
          disabled={submitting}
          onClick={handleReject}
        >
          반려
        </button>
        {status && <span className="text-xs text-green-600">{status}</span>}
        {error && <span className="text-xs text-red-600">{error}</span>}
      </div>
      {showCorrect && (
        <div className="flex items-center gap-2">
          <input
            className="flex-1 rounded border px-2 py-1 text-xs"
            placeholder="수정 내용을 입력하세요"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            disabled={submitting}
          />
          <button
            className="rounded border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50"
            disabled={submitting || !note.trim()}
            onClick={handleCorrectSubmit}
          >
            확인
          </button>
          <button
            className="rounded border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50"
            disabled={submitting}
            onClick={handleCorrectCancel}
          >
            취소
          </button>
        </div>
      )}
    </div>
  );
}

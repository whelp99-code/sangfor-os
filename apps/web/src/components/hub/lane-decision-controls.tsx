"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export function LaneDecisionControls({ projectId, domain }: { projectId: string; domain: string }) {
  const router = useRouter();
  const mounted = useRef(true);
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCorrect, setShowCorrect] = useState(false);
  const [note, setNote] = useState("");
  // 승인 시 승격된 산출물 문서로의 링크(체인이 없어 승격 스킵되면 undefined → 링크 미노출).
  const [documentId, setDocumentId] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      mounted.current = false;
    };
  }, []);

  async function post(body: Record<string, unknown>): Promise<boolean> {
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
      const data = (await res.json().catch(() => ({}))) as { documentId?: string };
      setDocumentId(typeof data.documentId === "string" ? data.documentId : null);
      router.refresh();
      setStatus("기록됨");
      setTimeout(() => {
        if (mounted.current) setStatus(null);
      }, 3000);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "오류 발생");
      return false;
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

  async function handleCorrectSubmit() {
    const success = await post({ domain, outcome: "corrected", note, humanEdit: { note } });
    if (success) {
      setShowCorrect(false);
      setNote("");
    }
  }

  function handleCorrectCancel() {
    setShowCorrect(false);
    setNote("");
  }

  return (
    <div className="mt-3 space-y-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="rounded border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50"
          disabled={submitting}
          onClick={handleApprove}
        >
          승인
        </button>
        <button
          type="button"
          className="rounded border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50"
          disabled={submitting}
          onClick={() => setShowCorrect(true)}
        >
          수정
        </button>
        <button
          type="button"
          className="rounded border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50"
          disabled={submitting}
          onClick={handleReject}
        >
          반려
        </button>
        {status && <span className="text-xs text-green-600">{status}</span>}
        {error && <span className="text-xs text-red-600">{error}</span>}
      </div>
      {documentId && (
        <Link
          href={`/proposals/${documentId}`}
          className="inline-block text-xs underline underline-offset-2"
          style={{ color: "#7C5E1E" }}
        >
          산출물 문서 보기 →
        </Link>
      )}
      {showCorrect && (
        <div className="flex items-center gap-2">
          <input
            aria-label="수정 내용"
            className="flex-1 rounded border px-2 py-1 text-xs"
            placeholder="수정 내용을 입력하세요"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            disabled={submitting}
          />
          <button
            type="button"
            className="rounded border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50"
            disabled={submitting || !note.trim()}
            onClick={handleCorrectSubmit}
          >
            확인
          </button>
          <button
            type="button"
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

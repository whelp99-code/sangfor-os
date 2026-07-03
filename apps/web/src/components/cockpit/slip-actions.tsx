"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

/**
 * 코크핏 전표의 사람 결정 액션 — 후보 승인/거부를 실제 백엔드로 전송.
 * PATCH /api/mail-candidates/[id] { action: "approve" | "reject" }.
 * 성공 시 router.refresh()로 서버 컴포넌트 재조회.
 */
export function SlipActions({
  candidateId,
  detailHref,
}: {
  candidateId: string;
  detailHref?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<null | "approve" | "reject">(null);
  const [error, setError] = useState<string | null>(null);

  async function run(action: "approve" | "reject") {
    setBusy(action);
    setError(null);
    try {
      const res = await fetch(`/api/mail-candidates/${candidateId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          action === "reject" ? { action: "reject", reasonCode: "manual_reject" } : { action: "approve" }
        ),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? body.error ?? `요청 실패 (${res.status})`);
      }
      startTransition(() => router.refresh());
    } catch (e) {
      setError(e instanceof Error ? e.message : "처리에 실패했습니다.");
    } finally {
      setBusy(null);
    }
  }

  const working = busy !== null || pending;

  return (
    <div className="act">
      <button
        type="button"
        className="btn ap"
        disabled={working}
        onClick={() => run("approve")}
      >
        {busy === "approve" ? "승인 중…" : "승인 · 전환"}
      </button>
      <button
        type="button"
        className="btn"
        disabled={working}
        onClick={() => run("reject")}
      >
        {busy === "reject" ? "거부 중…" : "거부"}
      </button>
      {detailHref ? (
        <Link href={detailHref} className="btn">
          상세
        </Link>
      ) : null}
      <span className="ago mono">
        {error ? (
          <span style={{ color: "var(--ck-red-deep)" }}>{error}</span>
        ) : (
          "사람 결정 → 학습"
        )}
      </span>
    </div>
  );
}

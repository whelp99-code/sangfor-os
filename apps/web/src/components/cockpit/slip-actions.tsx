"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { useToast } from "@sangfor/ui";

// mail-candidate-actions.tsx의 RejectReasonSelect 미러 — 갈라지면 학습 루프가 조용히 끊긴다.
const REJECT_REASONS = [
  { value: "weak_evidence", label: "근거 부족" },
  { value: "internal_company", label: "내부 회사" },
  { value: "system_sender", label: "시스템 발신자" },
  { value: "duplicate", label: "중복" },
  { value: "wrong_entity_role", label: "엔티티 역할 오류" },
  { value: "not_actionable", label: "조치 불가" },
] as const;

/**
 * 코크핏 전표의 사람 결정 액션 — 후보 승인/거부를 실제 백엔드로 전송.
 * PATCH /api/mail-candidates/[id] { action: "approve" | "reject" }.
 * 성공 시 router.refresh()로 서버 컴포넌트 재조회 + 토스트로 결과 고지.
 */
export function SlipActions({
  candidateId,
  detailHref,
  needsAiRevalidation,
}: {
  candidateId: string;
  detailHref?: string;
  /** true면 승인 시 project_candidate_requires_ai_revalidation 로 막힌다는 뜻. */
  needsAiRevalidation?: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<null | "approve" | "reject">(null);
  const [error, setError] = useState<string | null>(null);
  const [reasonCode, setReasonCode] = useState<string>(REJECT_REASONS[0].value);

  async function run(action: "approve" | "reject") {
    setBusy(action);
    setError(null);
    try {
      const res = await fetch(`/api/mail-candidates/${candidateId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          action === "reject" ? { action: "reject", reasonCode } : { action: "approve" }
        ),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? body.error ?? `요청 실패 (${res.status})`);
      }
      toast.success(action === "approve" ? "후보를 승인했습니다." : "후보를 거부했습니다.");
      startTransition(() => router.refresh());
    } catch (e) {
      const message = e instanceof Error ? e.message : "처리에 실패했습니다.";
      setError(message);
      toast.error(message);
    } finally {
      setBusy(null);
    }
  }

  const working = busy !== null || pending;

  return (
    <>
      {needsAiRevalidation ? (
        <div className="nudge">
          <b>!</b> AI 재검증 필요 — 승인 전 상세에서 검증을 먼저 실행하세요.
        </div>
      ) : null}
      <div className="act">
        <button
          type="button"
          className="btn ap"
          disabled={working}
          onClick={() => run("approve")}
        >
          {busy === "approve" ? "승인 중…" : "승인 · 전환"}
        </button>
        <select
          className="btn"
          aria-label="거부 사유"
          value={reasonCode}
          disabled={working}
          onChange={(e) => setReasonCode(e.target.value)}
        >
          {REJECT_REASONS.map((reason) => (
            <option key={reason.value} value={reason.value}>
              {reason.label}
            </option>
          ))}
        </select>
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
    </>
  );
}

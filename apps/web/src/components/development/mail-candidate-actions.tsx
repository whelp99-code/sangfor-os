"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { actionErrorMessage } from "@/lib/action-error-labels";

type Props = {
  candidateId?: string;
  status?: string;
  requiresAiCheck?: boolean;
};

export function GenerateMailCandidatesButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function generate() {
    setLoading(true);
    setMessage(null);
    const res = await fetch("/api/mail-candidates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ limit: 50 }),
    });
    const data = await res.json();
    if (res.ok) {
      setMessage(`생성 ${data.created}건, 건너뜀 ${data.skipped}건, 스캔 ${data.scanned}건`);
      router.refresh();
    } else {
      setMessage(actionErrorMessage(data.error, actionErrorMessage("generate_failed")));
    }
    setLoading(false);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button disabled={loading} onClick={generate} type="button">
        {loading ? "생성 중…" : "메일에서 생성"}
      </Button>
      {message ? <span className="text-xs text-muted-foreground">{message}</span> : null}
    </div>
  );
}

export function MailCandidateActions({ candidateId, status, requiresAiCheck = false }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reasonCode, setReasonCode] = useState("weak_evidence");

  async function patch(action: "approve" | "reject" | "revalidate") {
    if (!candidateId) return;
    setLoading(action);
    setError(null);
    const res = await fetch(`/api/mail-candidates/${candidateId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...(action === "reject" ? { reasonCode } : {}) }),
    });
    if (res.ok) {
      router.refresh();
    } else {
      const data = await res.json();
      setError(actionErrorMessage(data.error, actionErrorMessage("patch_failed")));
    }
    setLoading(null);
  }

  if (status !== "proposed" && status !== "needs_revalidation") return null;

  if (status === "needs_revalidation" || requiresAiCheck) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          disabled={loading != null}
          onClick={() => patch("revalidate")}
          type="button"
        >
          {loading === "revalidate" ? "확인 중…" : "AI 검증 실행"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={loading != null}
          onClick={() => patch("reject")}
          type="button"
        >
          {loading === "reject" ? "반려 중…" : "반려"}
        </Button>
        <RejectReasonSelect value={reasonCode} onChange={setReasonCode} />
        {error ? <span className="text-xs text-destructive">{error}</span> : null}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" disabled={loading != null} onClick={() => patch("approve")} type="button">
        {loading === "approve" ? "생성 중…" : "승인 및 생성"}
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={loading != null}
        onClick={() => patch("reject")}
        type="button"
      >
        {loading === "reject" ? "반려 중…" : "반려"}
      </Button>
      <RejectReasonSelect value={reasonCode} onChange={setReasonCode} />
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </div>
  );
}

function RejectReasonSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <select
      className="h-8 rounded-md border bg-background px-2 text-xs"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      aria-label="반려 사유"
    >
      <option value="weak_evidence">근거 부족</option>
      <option value="internal_company">내부 회사</option>
      <option value="system_sender">시스템 발신자</option>
      <option value="duplicate">중복</option>
      <option value="wrong_entity_role">엔티티 역할 오류</option>
      <option value="not_actionable">조치 불가</option>
    </select>
  );
}

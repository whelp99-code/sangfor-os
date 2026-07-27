"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { actionErrorMessage } from "@/lib/action-error-labels";

type ConnectionDefaults = {
  customer: { name: string; domain?: string; notes?: string };
  contact: { name: string; email: string; role: string } | null;
  opportunity: { title: string; nextAction: string; probability: number };
  proposal: { title: string; templateKey: string };
  evidence: {
    summary: string;
    items: string[];
    nextActions: string[];
    sourceTitle: string | null;
    sourceSender: string | null;
    sourceMessageIds: string[];
    missingFields: string[];
    riskFlags: string[];
  };
};

type Props = {
  candidateId: string;
  candidateType: string;
  status: string;
  expectedUpdatedAt: string;
  defaults: ConnectionDefaults;
};

export function ApproveConnectForm({ candidateId, candidateType, status, expectedUpdatedAt, defaults }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (status !== "proposed") {
    return <p className="text-sm text-muted-foreground">제안 상태인 후보만 연결할 수 있습니다.</p>;
  }

  async function submit() {
    setLoading(true);
    setError(null);
    const res = await fetch(`/api/mail-candidates/${candidateId}/connect`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": `mail-candidate-connect-${candidateId}-${crypto.randomUUID()}`,
      },
      body: JSON.stringify({ expectedUpdatedAt }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(actionErrorMessage(data.error, actionErrorMessage("connect_failed")));
      setLoading(false);
      return;
    }
    router.push(data.redirectTo ?? "/approvals");
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-muted/20 p-3 text-sm">
        <p className="font-medium">이어받을 메일 근거</p>
        <p className="mt-1 break-words text-muted-foreground">{defaults.evidence.summary}</p>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <EvidencePreview title="근거 항목" items={defaults.evidence.items} />
          <EvidencePreview title="다음 조치" items={defaults.evidence.nextActions} />
          <EvidencePreview title="누락 필드" items={defaults.evidence.missingFields} />
          <EvidencePreview title="위험 플래그" items={defaults.evidence.riskFlags} />
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          출처: {defaults.evidence.sourceTitle ?? "메일"} · 발신자: {defaults.evidence.sourceSender ?? "알 수 없음"}
        </p>
      </div>
      <div className="rounded-lg border bg-muted/20 p-3 text-sm">
        <p className="font-medium">생성 예정: {candidateRecordLabel(candidateType)} 1건</p>
        <p className="mt-1 text-muted-foreground">
          후보 유형에 맞는 운영 레코드를 생성하거나 기존 동일 레코드와 병합합니다.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" disabled={loading} onClick={submit}>
          {loading ? "연결 중…" : "승인 및 연결"}
        </Button>
        {error ? <span className="text-sm text-destructive">{error}</span> : null}
      </div>
    </div>
  );
}

function candidateRecordLabel(candidateType: string) {
  return {
    customer: "고객",
    partner: "파트너",
    opportunity: "영업 기회",
    task: "업무",
    poc: "제안서 초안",
  }[candidateType] ?? "운영 레코드";
}

function EvidencePreview({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-md bg-background/80 p-2">
      <p className="text-xs font-medium text-muted-foreground">{title}</p>
      {items.length === 0 ? (
        <p className="mt-1 text-xs text-muted-foreground">없음</p>
      ) : (
        <ul className="mt-1 space-y-1 text-xs">
          {items.map((item, index) => (
            <li key={`${title}-${index}`} className="break-words">
              {item}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

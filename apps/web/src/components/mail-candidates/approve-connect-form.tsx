"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  status: string;
  defaults: ConnectionDefaults;
};

export function ApproveConnectForm({ candidateId, status, defaults }: Props) {
  const router = useRouter();
  const [customerName, setCustomerName] = useState(defaults.customer.name);
  const [customerDomain, setCustomerDomain] = useState(defaults.customer.domain ?? "");
  const [contactName, setContactName] = useState(defaults.contact?.name ?? "");
  const [contactEmail, setContactEmail] = useState(defaults.contact?.email ?? "");
  const [opportunityTitle, setOpportunityTitle] = useState(defaults.opportunity.title);
  const [proposalTitle, setProposalTitle] = useState(defaults.proposal.title);
  const [createProposal, setCreateProposal] = useState(true);
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
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customer: { mode: "create", name: customerName, domain: customerDomain || undefined },
        contact: contactName || contactEmail
          ? { mode: "create", name: contactName || "메일 요청자", email: contactEmail || undefined }
          : { mode: "skip" },
        opportunity: { mode: "create", title: opportunityTitle, nextAction: defaults.opportunity.nextAction },
        proposal: createProposal
          ? { mode: "create", title: proposalTitle, templateKey: defaults.proposal.templateKey }
          : { mode: "skip" },
      }),
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
      <div className="grid gap-3 md:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span className="text-xs text-muted-foreground">고객명</span>
          <Input value={customerName} onChange={(event) => setCustomerName(event.target.value)} />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-xs text-muted-foreground">고객 도메인</span>
          <Input value={customerDomain} onChange={(event) => setCustomerDomain(event.target.value)} />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-xs text-muted-foreground">담당자명</span>
          <Input value={contactName} onChange={(event) => setContactName(event.target.value)} />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-xs text-muted-foreground">담당자 이메일</span>
          <Input value={contactEmail} onChange={(event) => setContactEmail(event.target.value)} />
        </label>
        <label className="space-y-1 text-sm md:col-span-2">
          <span className="text-xs text-muted-foreground">기회명</span>
          <Input value={opportunityTitle} onChange={(event) => setOpportunityTitle(event.target.value)} />
        </label>
        <label className="space-y-1 text-sm md:col-span-2">
          <span className="text-xs text-muted-foreground">제안서 제목</span>
          <Input
            value={proposalTitle}
            disabled={!createProposal}
            onChange={(event) => setProposalTitle(event.target.value)}
          />
        </label>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={createProposal}
          onChange={(event) => setCreateProposal(event.target.checked)}
        />
        승인된 메일 근거로 제안서 초안 생성
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" disabled={loading || !customerName || !opportunityTitle} onClick={submit}>
          {loading ? "연결 중…" : "승인 및 연결"}
        </Button>
        {error ? <span className="text-sm text-destructive">{error}</span> : null}
      </div>
    </div>
  );
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

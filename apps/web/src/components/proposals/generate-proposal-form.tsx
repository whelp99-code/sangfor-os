"use client";

import { PROPOSAL_TEMPLATE_KEYS } from "@sangfor/shared";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { proposalTemplateLabel } from "@/lib/proposal-template-labels";

type Option = { id: string; label: string };

export function GenerateProposalForm({
  customers,
  pocProjects,
}: {
  customers: Option[];
  pocProjects: Option[];
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [templateKey, setTemplateKey] = useState<string>(PROPOSAL_TEMPLATE_KEYS[0]);
  const [customerId, setCustomerId] = useState("");
  const [pocProjectId, setPocProjectId] = useState("");
  const [scope, setScope] = useState("");
  const [timeline, setTimeline] = useState("");
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMessage(null);
    const variables: Record<string, string> = {};
    if (scope) variables.scope = scope;
    if (timeline) variables.timeline = timeline;
    if (amount) variables.amount = amount;

    const res = await fetch("/api/proposals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        templateKey,
        projectSlug: "demo-project",
        customerId: customerId || undefined,
        pocProjectId: pocProjectId || undefined,
        variables,
      }),
    });
    const data = await res.json();
    setLoading(false);
    if (res.ok) {
      router.push(`/proposals/${data.document.id}`);
      router.refresh();
    } else {
      setMessage(data.error ?? "제안서 생성에 실패했습니다.");
    }
  }

  return (
    <form className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3" onSubmit={onSubmit}>
      <Input
        aria-label="문서 제목"
        placeholder="문서 제목"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        required
      />
      <select
        aria-label="템플릿"
        className="h-9 rounded-md border bg-background px-2 text-sm"
        value={templateKey}
        onChange={(e) => setTemplateKey(e.target.value)}
      >
        {PROPOSAL_TEMPLATE_KEYS.map((k) => (
          <option key={k} value={k}>{proposalTemplateLabel(k)}</option>
        ))}
      </select>
      <select
        aria-label="고객사 (선택)"
        className="h-9 rounded-md border bg-background px-2 text-sm"
        value={customerId}
        onChange={(e) => setCustomerId(e.target.value)}
      >
        <option value="">고객사 (선택)</option>
        {customers.map((c) => (
          <option key={c.id} value={c.id}>{c.label}</option>
        ))}
      </select>
      <select
        aria-label="PoC (선택)"
        className="h-9 rounded-md border bg-background px-2 text-sm"
        value={pocProjectId}
        onChange={(e) => setPocProjectId(e.target.value)}
      >
        <option value="">PoC (선택)</option>
        {pocProjects.map((p) => (
          <option key={p.id} value={p.id}>{p.label}</option>
        ))}
      </select>
      <Input
        aria-label="범위 재정의 (선택)"
        placeholder="범위 재정의 (선택)"
        value={scope}
        onChange={(e) => setScope(e.target.value)}
      />
      <Input
        aria-label="일정 재정의 (선택)"
        placeholder="일정 재정의 (선택)"
        value={timeline}
        onChange={(e) => setTimeline(e.target.value)}
      />
      <Input
        aria-label="금액 재정의 (선택)"
        placeholder="금액 재정의 (선택)"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
      />
      <Button type="submit" disabled={loading} className="sm:col-span-2 lg:col-span-1">
        {loading ? "생성 중..." : "생성"}
      </Button>
      {message ? <p className="text-sm text-destructive sm:col-span-2 lg:col-span-3">{message}</p> : null}
    </form>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { actionErrorMessage } from "@/lib/action-error-labels";
import { OPPORTUNITY_STAGES } from "@/lib/poc-constants";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Option = { id: string; label: string };

function toIsoDate(date: string): string | null {
  if (!date) return null;
  return new Date(`${date}T12:00:00.000Z`).toISOString();
}

function formatDateInput(value: Date | string | null | undefined): string {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

export function EditOpportunityForm({
  opportunityId,
  initial,
  customers,
  partners,
}: {
  opportunityId: string;
  initial: {
    title: string;
    stage: string;
    amount: string | number | null;
    probability: number;
    closeDate: Date | null;
    nextAction: string | null;
    customerId: string | null;
    partnerId: string | null;
  };
  customers: Option[];
  partners: Option[];
}) {
  const router = useRouter();
  const [title, setTitle] = useState(initial.title);
  const [stage, setStage] = useState(initial.stage);
  const [amount, setAmount] = useState(initial.amount?.toString() ?? "");
  const [probability, setProbability] = useState(String(initial.probability));
  const [closeDate, setCloseDate] = useState(formatDateInput(initial.closeDate));
  const [nextAction, setNextAction] = useState(initial.nextAction ?? "");
  const [customerId, setCustomerId] = useState(initial.customerId ?? "");
  const [partnerId, setPartnerId] = useState(initial.partnerId ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/opportunities/${opportunityId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          stage,
          amount: amount ? Number(amount) : undefined,
          probability: Number(probability),
          closeDate: toIsoDate(closeDate),
          nextAction: nextAction || null,
          customerId: customerId || null,
          partnerId: partnerId || null,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(actionErrorMessage((data as { error?: string }).error, "기회 정보를 저장하지 못했습니다."));
        return;
      }
      router.refresh();
    } catch {
      setError("기회 정보를 저장하지 못했습니다. 네트워크를 확인해 주세요.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="grid gap-2 sm:grid-cols-2" onSubmit={onSubmit}>
      <Input aria-label="기회 제목" value={title} onChange={(e) => setTitle(e.target.value)} required />
      <select
        aria-label="단계"
        className="h-9 rounded-md border bg-background px-2 text-sm"
        value={stage}
        onChange={(e) => setStage(e.target.value)}
      >
        {OPPORTUNITY_STAGES.map((s) => (
          <option key={s} value={s}>{s}</option>
        ))}
      </select>
      <select
        aria-label="고객사"
        className="h-9 rounded-md border bg-background px-2 text-sm"
        value={customerId}
        onChange={(e) => setCustomerId(e.target.value)}
      >
        <option value="">고객사 없음</option>
        {customers.map((c) => (
          <option key={c.id} value={c.id}>{c.label}</option>
        ))}
      </select>
      <select
        aria-label="파트너"
        className="h-9 rounded-md border bg-background px-2 text-sm"
        value={partnerId}
        onChange={(e) => setPartnerId(e.target.value)}
      >
        <option value="">파트너 없음</option>
        {partners.map((p) => (
          <option key={p.id} value={p.id}>{p.label}</option>
        ))}
      </select>
      <Input aria-label="금액" type="number" placeholder="금액" value={amount} onChange={(e) => setAmount(e.target.value)} />
      <Input aria-label="확률 %" type="number" min={0} max={100} value={probability} onChange={(e) => setProbability(e.target.value)} />
      <Input aria-label="마감일" type="date" value={closeDate} onChange={(e) => setCloseDate(e.target.value)} />
      <Input aria-label="다음 조치" placeholder="다음 조치" value={nextAction} onChange={(e) => setNextAction(e.target.value)} />
      <Button type="submit" size="sm" disabled={loading} className="sm:col-span-2">
        {loading ? "저장 중..." : "기회 저장"}
      </Button>
      {error && (
        <p className="text-xs text-destructive sm:col-span-2" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

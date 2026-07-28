"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type CustomerDetailActionsProps = {
  customer: {
    id: string;
    name: string;
    domain: string | null;
    industry: string | null;
    notes: string | null;
    status: string;
  };
  expectedUpdatedAt: string;
  canWrite: boolean;
};

export function CustomerDetailActions({
  customer,
  expectedUpdatedAt: initialExpectedUpdatedAt,
  canWrite,
}: CustomerDetailActionsProps) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [expectedUpdatedAt, setExpectedUpdatedAt] = useState(initialExpectedUpdatedAt);
  const [name, setName] = useState(customer.name);
  const [domain, setDomain] = useState(customer.domain ?? "");
  const [industry, setIndustry] = useState(customer.industry ?? "");
  const [notes, setNotes] = useState(customer.notes ?? "");
  const [status, setStatus] = useState(customer.status);

  if (!canWrite) return null;

  async function save() {
    setPending(true);
    setMessage(null);
    const changes = {
      name,
      domain: domain.trim() || null,
      industry: industry.trim() || null,
      notes: notes.trim() || null,
      status,
    };
    try {
      const response = await fetch(`/api/customers/${customer.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({ expectedUpdatedAt, changes }),
      });
      const payload = await response.json().catch(() => ({})) as {
        customer?: { updatedAt?: string };
        error?: string;
      };
      if (!response.ok) {
        setMessage(payload.error === "CONFLICT" ? "다른 변경이 먼저 저장되었습니다. 새로고침 후 다시 시도하세요." : "고객사를 수정하지 못했습니다.");
        return;
      }
      if (payload.customer?.updatedAt) setExpectedUpdatedAt(payload.customer.updatedAt);
      setEditing(false);
      router.refresh();
    } catch {
      setMessage("고객사를 수정하지 못했습니다.");
    } finally {
      setPending(false);
    }
  }

  async function archive() {
    if (!window.confirm("이 고객사를 보관하시겠습니까?")) return;
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/customers/${customer.id}`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({ expectedUpdatedAt }),
      });
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) {
        setMessage(payload.error === "CONFLICT" ? "다른 변경이 먼저 저장되었습니다. 새로고침 후 다시 시도하세요." : "고객사를 보관하지 못했습니다.");
        return;
      }
      router.push("/customers");
      router.refresh();
    } catch {
      setMessage("고객사를 보관하지 못했습니다.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="outline" onClick={() => setEditing((value) => !value)}>
          {editing ? "수정 닫기" : "고객사 수정"}
        </Button>
        <Button type="button" size="sm" variant="destructive" disabled={pending} onClick={archive}>
          고객사 보관
        </Button>
      </div>
      {editing ? (
        <div className="grid gap-2 rounded-lg border bg-card p-3 sm:grid-cols-2">
          <Input aria-label="고객사 이름" value={name} onChange={(event) => setName(event.target.value)} />
          <Input aria-label="도메인" value={domain} onChange={(event) => setDomain(event.target.value)} />
          <Input aria-label="업종" value={industry} onChange={(event) => setIndustry(event.target.value)} />
          <select
            aria-label="고객사 상태"
            className="h-9 rounded-md border bg-background px-3 text-sm"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="active">활성</option>
            <option value="inactive">비활성</option>
            <option value="archived">보관</option>
          </select>
          <Input
            aria-label="메모"
            className="sm:col-span-2"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
          <div className="flex gap-2 sm:col-span-2">
            <Button type="button" size="sm" disabled={pending || name.trim().length < 2} onClick={save}>
              {pending ? "저장 중..." : "변경 저장"}
            </Button>
          </div>
        </div>
      ) : null}
      {message ? <p className="text-sm text-destructive">{message}</p> : null}
    </div>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useToast } from "@sangfor/ui";

const STATUSES = [
  ["pending", "대상 감지"],
  ["notified", "안내 발송"],
  ["quote_requested", "견적 요청"],
  ["vendor_quote", "총판 견적"],
  ["delivered", "고객 전달"],
  ["po", "PO·구매"],
  ["renewed", "갱신 완료"],
  ["lost", "갱신 실패"],
] as const;

export function RenewalStatusControl({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function update(next: string) {
    if (next === status) return;
    if ((next === "renewed" || next === "lost") && !window.confirm("리뉴얼을 종료 상태로 변경할까요?")) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/renewals/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      if (!response.ok) {
        toast.error("리뉴얼 상태를 변경하지 못했습니다.");
        return;
      }
      toast.success("리뉴얼 상태를 변경했습니다.");
      router.refresh();
    } catch {
      toast.error("네트워크 오류가 발생했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <select aria-label="리뉴얼 상태" disabled={busy} value={status} onChange={(event) => void update(event.target.value)} className="h-8 rounded-md border bg-background px-2 text-xs">
      {STATUSES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
    </select>
  );
}

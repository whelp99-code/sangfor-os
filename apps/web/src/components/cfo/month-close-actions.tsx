"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";

export function MonthCloseActions({
  year,
  month,
  ready,
  status,
}: {
  year: number;
  month: number;
  ready: boolean;
  status: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  async function run(action: "start" | "complete") {
    if (action === "complete") {
      const approved = window.confirm(
        `${year}년 ${month}월 장부를 마감할까요? 완료 후에는 같은 기간을 다시 마감할 수 없습니다.`,
      );
      if (!approved) return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/finance/month-close/${year}/${month}/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!response.ok) {
        setMessage({ tone: "error", text: action === "start" ? "월 마감을 시작하지 못했습니다." : "월 마감을 완료하지 못했습니다." });
        return;
      }
      setMessage({ tone: "ok", text: action === "start" ? "월 마감을 시작했습니다." : "월 마감을 완료했습니다." });
      router.refresh();
    } catch {
      setMessage({ tone: "error", text: "재무 서버에 연결하지 못했습니다." });
    } finally {
      setBusy(false);
    }
  }

  if (status === "completed") {
    return <span className="text-sm font-medium text-green-700">마감 완료</span>;
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        {status !== "in_progress" && (
          <Button variant="outline" disabled={busy} onClick={() => void run("start")}>
            마감 시작
          </Button>
        )}
        <Button
          aria-describedby={!ready ? "month-close-not-ready" : undefined}
          disabled={busy || !ready}
          onClick={() => void run("complete")}
        >
          마감 완료
        </Button>
      </div>
      {!ready && (
        <p id="month-close-not-ready" className="max-w-64 text-right text-xs text-zinc-500">
          미처리 항목을 모두 해결하면 완료할 수 있습니다.
        </p>
      )}
      {message && <p role="status" className={message.tone === "ok" ? "text-xs text-green-700" : "text-xs text-red-700"}>{message.text}</p>}
    </div>
  );
}

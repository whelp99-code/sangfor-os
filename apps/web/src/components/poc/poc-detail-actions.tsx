"use client";

import { useState } from "react";

import { actionErrorMessage } from "@/lib/action-error-labels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Props = { pocId: string };

export function PocRequirementForm({ pocId }: Props) {
  const [label, setLabel] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/poc/${pocId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "add_requirement", label }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(actionErrorMessage((data as { error?: string }).error, "요구사항을 추가하지 못했습니다."));
        return;
      }
      window.location.reload();
    } catch {
      setError("요구사항을 추가하지 못했습니다. 네트워크를 확인해 주세요.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="flex flex-wrap gap-2" onSubmit={onSubmit}>
      <Input aria-label="요구사항 항목" placeholder="요구사항 항목" value={label} onChange={(e) => setLabel(e.target.value)} required />
      <Button type="submit" size="sm" disabled={loading}>추가</Button>
      {error && (
        <p className="w-full text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

export function PocEventForm({ pocId }: Props) {
  const [eventType, setEventType] = useState("milestone");
  const [summary, setSummary] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/poc/${pocId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "add_event", eventType, summary }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(actionErrorMessage((data as { error?: string }).error, "이벤트를 기록하지 못했습니다."));
        return;
      }
      window.location.reload();
    } catch {
      setError("이벤트를 기록하지 못했습니다. 네트워크를 확인해 주세요.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="flex flex-col gap-2 sm:flex-row" onSubmit={onSubmit}>
      <Input aria-label="이벤트 유형" placeholder="이벤트 유형" value={eventType} onChange={(e) => setEventType(e.target.value)} />
      <Input aria-label="요약" placeholder="요약" value={summary} onChange={(e) => setSummary(e.target.value)} required />
      <Button type="submit" size="sm" disabled={loading}>이벤트 기록</Button>
      {error && (
        <p className="w-full text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

export function GeneratePocReportButton({ pocId }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/poc/${pocId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "generate_report" }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(actionErrorMessage((data as { error?: string }).error, "보고서를 생성하지 못했습니다."));
        return;
      }
      window.location.reload();
    } catch {
      setError("보고서를 생성하지 못했습니다. 네트워크를 확인해 주세요.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-1">
      <Button size="sm" onClick={generate} disabled={loading}>
        {loading ? "생성 중..." : "결과 보고서 생성"}
      </Button>
      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

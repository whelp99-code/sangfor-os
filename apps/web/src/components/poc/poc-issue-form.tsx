"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { actionErrorMessage } from "@/lib/action-error-labels";
import { POC_ISSUE_STATUSES } from "@/lib/poc-constants";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

export function PocIssueForm({ pocId }: { pocId: string }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [severity, setSeverity] = useState("medium");
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
        body: JSON.stringify({ action: "add_issue", title, severity }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(actionErrorMessage((data as { error?: string }).error, "이슈를 추가하지 못했습니다."));
        return;
      }
      setTitle("");
      router.refresh();
    } catch {
      setError("이슈를 추가하지 못했습니다. 네트워크를 확인해 주세요.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="flex flex-wrap gap-2" onSubmit={onSubmit}>
      <Input aria-label="이슈 제목" placeholder="이슈 제목" value={title} onChange={(e) => setTitle(e.target.value)} required />
      <select
        aria-label="심각도"
        className="h-9 rounded-md border bg-background px-2 text-sm"
        value={severity}
        onChange={(e) => setSeverity(e.target.value)}
      >
        <option value="low">낮음</option>
        <option value="medium">보통</option>
        <option value="high">높음</option>
      </select>
      <Button type="submit" size="sm" disabled={loading}>이슈 추가</Button>
      {error && (
        <p className="w-full text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

export function PocIssueRow({
  pocId,
  issue,
}: {
  pocId: string;
  issue: { id: string; title: string; severity: string; status: string };
}) {
  const router = useRouter();
  const [status, setStatus] = useState(issue.status);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onStatusChange(next: string) {
    const previous = status;
    setStatus(next);
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/poc/${pocId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update_issue", issueId: issue.id, status: next }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setStatus(previous);
        setError(actionErrorMessage((data as { error?: string }).error, "상태를 변경하지 못했습니다."));
        return;
      }
      router.refresh();
    } catch {
      setStatus(previous);
      setError("상태를 변경하지 못했습니다. 네트워크를 확인해 주세요.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span>{issue.title}</span>
      <div className="flex items-center gap-2">
        <Badge variant="secondary">{issue.severity}</Badge>
        <select
          aria-label={`${issue.title} 상태`}
          className="h-8 rounded-md border bg-background px-2 text-xs"
          value={status}
          disabled={loading}
          onChange={(e) => onStatusChange(e.target.value)}
        >
          {POC_ISSUE_STATUSES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        {error && (
          <span className="text-xs text-destructive" role="alert">
            {error}
          </span>
        )}
      </div>
    </div>
  );
}

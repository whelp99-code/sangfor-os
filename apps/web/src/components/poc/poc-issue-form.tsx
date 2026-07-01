"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { POC_ISSUE_STATUSES } from "@/lib/poc-constants";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

export function PocIssueForm({ pocId }: { pocId: string }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [severity, setSeverity] = useState("medium");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    await fetch(`/api/poc/${pocId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "add_issue", title, severity }),
    });
    setLoading(false);
    setTitle("");
    router.refresh();
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
        <option value="low">low</option>
        <option value="medium">medium</option>
        <option value="high">high</option>
      </select>
      <Button type="submit" size="sm" disabled={loading}>이슈 추가</Button>
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

  async function onStatusChange(next: string) {
    setStatus(next);
    setLoading(true);
    await fetch(`/api/poc/${pocId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "update_issue", issueId: issue.id, status: next }),
    });
    setLoading(false);
    router.refresh();
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
      </div>
    </div>
  );
}

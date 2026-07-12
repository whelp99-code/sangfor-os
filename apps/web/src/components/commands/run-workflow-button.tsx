"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";

export function RunWorkflowButton({ commandRunId }: { commandRunId: string }) {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function runWorkflow() {
    setLoading(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/workflows/${commandRunId}/run`, { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "failed");
      setMessage("워크플로 모의 실행 완료");
      window.location.reload();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      <Button variant="secondary" onClick={runWorkflow} disabled={loading}>
        {loading ? "실행 중…" : "워크플로 모의 실행"}
      </Button>
      {message ? <span className="text-sm text-muted-foreground">{message}</span> : null}
    </div>
  );
}

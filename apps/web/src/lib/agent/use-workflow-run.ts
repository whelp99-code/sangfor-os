"use client";

import { useCallback, useRef, useState } from "react";
import type { StageResult } from "@sangfor/agent";

export type WorkflowPhase = "idle" | "running" | "completed" | "blocked" | "error";

function parseRecord(record: string): { event: string; data: unknown } | null {
  let event = "message";
  const dataLines: string[] = [];
  for (const line of record.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }
  if (dataLines.length === 0) return null;
  try {
    return { event, data: JSON.parse(dataLines.join("\n")) };
  } catch {
    return null;
  }
}

/** Streams the cross-service workflow over SSE and exposes per-stage state. */
export function useWorkflowRun() {
  const [phase, setPhase] = useState<WorkflowPhase>("idle");
  const [stages, setStages] = useState<StageResult[]>([]);
  const [awaitingApproval, setAwaitingApproval] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [requirements, setRequirements] = useState("");
  const activeRef = useRef(false);

  const run = useCallback(async (input: { requirements: string; approvals?: string[] }) => {
    if (activeRef.current) return;
    activeRef.current = true;
    setPhase("running");
    setStages([]);
    setAwaitingApproval(null);
    setError(null);
    setRequirements(input.requirements);

    try {
      const res = await fetch("/api/agent/workflow/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok || !res.body) {
        const detail = await res.json().catch(() => ({}));
        setPhase("error");
        setError(detail.error ?? `요청 실패 (HTTP ${res.status})`);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const records = buffer.split("\n\n");
        buffer = records.pop() ?? "";
        for (const record of records) {
          const parsed = parseRecord(record);
          if (!parsed) continue;
          const d = parsed.data as Record<string, unknown>;
          if (parsed.event === "stage") setStages((prev) => [...prev, d as unknown as StageResult]);
          else if (parsed.event === "done") {
            setPhase((d.status as WorkflowPhase) ?? "completed");
            if (d.status === "blocked") setAwaitingApproval(String(d.awaitingApproval ?? ""));
          } else if (parsed.event === "error") {
            setPhase("error");
            setError(String(d.message ?? "워크플로우 오류"));
          }
        }
      }
    } catch (e) {
      setPhase("error");
      setError(e instanceof Error ? e.message : "스트리밍 오류");
    } finally {
      activeRef.current = false;
    }
  }, []);

  return { phase, stages, awaitingApproval, error, requirements, run };
}

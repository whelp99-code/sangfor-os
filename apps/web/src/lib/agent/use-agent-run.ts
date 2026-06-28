"use client";

import { useCallback, useRef, useState } from "react";
import type { AgentStatus, AgentStep } from "@sangfor/agent";

export type RunPhase = "idle" | "running" | AgentStatus;

export interface RunInput {
  goal: string;
  maxSteps?: number;
  allowUnsafe?: boolean;
  source?: "manual" | "playbook" | "schedule";
  playbookId?: string;
}

export interface BlockedInfo {
  tool: string;
  arguments?: Record<string, unknown>;
}

/** Parse one SSE record ("event: x\ndata: {...}") into {event, data}. */
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

/**
 * Client hook that streams an agent run over SSE and exposes incremental state.
 * Shared by the run console and one-click playbook execution.
 */
export function useAgentRun() {
  const [phase, setPhase] = useState<RunPhase>("idle");
  const [steps, setSteps] = useState<AgentStep[]>([]);
  const [answer, setAnswer] = useState<string | undefined>();
  const [blocked, setBlocked] = useState<BlockedInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [goal, setGoal] = useState<string>("");
  const activeRef = useRef(false);

  const reset = useCallback(() => {
    setPhase("idle");
    setSteps([]);
    setAnswer(undefined);
    setBlocked(null);
    setError(null);
    setRunId(null);
  }, []);

  const run = useCallback(async (input: RunInput) => {
    if (activeRef.current) return;
    activeRef.current = true;
    setPhase("running");
    setSteps([]);
    setAnswer(undefined);
    setBlocked(null);
    setError(null);
    setRunId(null);
    setGoal(input.goal);

    try {
      const res = await fetch("/api/agent/run", {
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
          dispatch(parsed.event, parsed.data);
        }
      }
    } catch (e) {
      setPhase("error");
      setError(e instanceof Error ? e.message : "스트리밍 오류");
    } finally {
      activeRef.current = false;
    }

    function dispatch(event: string, data: unknown) {
      const d = data as Record<string, unknown>;
      switch (event) {
        case "run":
          setRunId(String(d.id));
          break;
        case "step":
          setSteps((prev) => [...prev, d as unknown as AgentStep]);
          break;
        case "done":
          setPhase((d.status as AgentStatus) ?? "completed");
          setAnswer(d.answer as string | undefined);
          if (d.status === "blocked") {
            setBlocked({
              tool: String(d.blockedTool ?? ""),
              arguments: d.blockedArguments as Record<string, unknown> | undefined,
            });
          }
          break;
        case "error":
          setPhase("error");
          setError(String(d.message ?? "에이전트 오류"));
          break;
      }
    }
  }, []);

  return { phase, steps, answer, blocked, error, runId, goal, run, reset };
}

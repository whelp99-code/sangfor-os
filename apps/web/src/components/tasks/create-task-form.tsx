"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { PRIORITY_OPTIONS } from "./task-meta";

export type EngagementOption = { id: string; name: string };

type Props = {
  /** When provided, the engagement picker is hidden and tasks are pinned to this engagement. */
  engagementId?: string;
  /** When provided (and engagementId is not), renders a picker so the task can be linked to a project. */
  engagements?: EngagementOption[];
  projectSlug?: string;
};

export function CreateTaskForm({ engagementId, engagements, projectSlug = "demo-project" }: Props) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [assigneeName, setAssigneeName] = useState("");
  const [priority, setPriority] = useState("normal");
  const [dueAt, setDueAt] = useState("");
  const [selectedEngagement, setSelectedEngagement] = useState<string>("");
  const [loading, setLoading] = useState(false);

  const showPicker = !engagementId && engagements && engagements.length > 0;

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    const resolvedEngagementId = engagementId ?? (selectedEngagement || undefined);
    const response = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        priority,
        assigneeName: assigneeName || undefined,
        dueAt: dueAt ? new Date(dueAt).toISOString() : undefined,
        engagementId: resolvedEngagementId,
        projectSlug,
      }),
    });
    setLoading(false);
    if (response.ok) {
      setTitle("");
      setAssigneeName("");
      setPriority("normal");
      setDueAt("");
      setSelectedEngagement("");
      router.refresh();
    }
  }

  return (
    <form
      className={`grid gap-2 ${showPicker ? "md:grid-cols-6" : "md:grid-cols-5"}`}
      onSubmit={onSubmit}
    >
      <Input
        aria-label="작업 제목"
        placeholder="작업 제목"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        required
      />
      <Input
        aria-label="담당자"
        placeholder="담당자"
        value={assigneeName}
        onChange={(event) => setAssigneeName(event.target.value)}
      />
      <Select value={priority} onValueChange={(val) => setPriority(val ?? "normal")}>
        <SelectTrigger aria-label="우선순위">
          <SelectValue placeholder="우선순위" />
        </SelectTrigger>
        <SelectContent>
          {PRIORITY_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Input
        aria-label="마감일시"
        type="datetime-local"
        value={dueAt}
        onChange={(event) => setDueAt(event.target.value)}
      />
      {showPicker ? (
        <Select value={selectedEngagement} onValueChange={(val) => setSelectedEngagement(val ?? "")}>
          <SelectTrigger aria-label="프로젝트(선택)">
            <SelectValue placeholder="프로젝트(선택)" />
          </SelectTrigger>
          <SelectContent>
            {engagements!.map((e) => (
              <SelectItem key={e.id} value={e.id}>
                {e.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
      <Button type="submit" disabled={loading}>
        {loading ? "저장 중..." : "작업 추가"}
      </Button>
    </form>
  );
}

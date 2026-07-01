"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Props = { pocId: string };

export function PocRequirementForm({ pocId }: Props) {
  const [label, setLabel] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    await fetch(`/api/poc/${pocId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "add_requirement", label }),
    });
    window.location.reload();
  }

  return (
    <form className="flex gap-2" onSubmit={onSubmit}>
      <Input aria-label="요구사항 항목" placeholder="요구사항 항목" value={label} onChange={(e) => setLabel(e.target.value)} required />
      <Button type="submit" size="sm" disabled={loading}>추가</Button>
    </form>
  );
}

export function PocEventForm({ pocId }: Props) {
  const [eventType, setEventType] = useState("milestone");
  const [summary, setSummary] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    await fetch(`/api/poc/${pocId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "add_event", eventType, summary }),
    });
    window.location.reload();
  }

  return (
    <form className="flex flex-col gap-2 sm:flex-row" onSubmit={onSubmit}>
      <Input aria-label="이벤트 유형" placeholder="이벤트 유형" value={eventType} onChange={(e) => setEventType(e.target.value)} />
      <Input aria-label="요약" placeholder="요약" value={summary} onChange={(e) => setSummary(e.target.value)} required />
      <Button type="submit" size="sm" disabled={loading}>이벤트 기록</Button>
    </form>
  );
}

export function GeneratePocReportButton({ pocId }: Props) {
  const [loading, setLoading] = useState(false);

  async function generate() {
    setLoading(true);
    await fetch(`/api/poc/${pocId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "generate_report" }),
    });
    window.location.reload();
  }

  return (
    <Button size="sm" onClick={generate} disabled={loading}>
      {loading ? "생성 중..." : "결과 보고서 생성"}
    </Button>
  );
}

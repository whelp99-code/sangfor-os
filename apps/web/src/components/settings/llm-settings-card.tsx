"use client";

import { useEffect, useState } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type Status = {
  configured: boolean;
  source: "env" | "saved" | "none";
  keyMasked?: string;
  baseUrl?: string;
  model?: string;
};

export function LlmSettingsCard() {
  const [status, setStatus] = useState<Status | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = () =>
    fetch("/api/settings/llm")
      .then((r) => r.json())
      .then((s: Status) => {
        setStatus(s);
        setBaseUrl(s.baseUrl ?? "");
        setModel(s.model ?? "");
      });

  useEffect(() => {
    load();
  }, []);

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const body: Record<string, string> = { baseUrl, model };
      if (apiKey.trim()) body.apiKey = apiKey.trim(); // only send key when changed
      const res = await fetch("/api/settings/llm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then((r) => r.json());
      if (res.success) {
        setMsg(res.configured ? "저장됨 — LLM 활성화" : "저장됨 (키 없음)");
        setApiKey("");
        await load();
      } else {
        setMsg(`오류: ${res.error}`);
      }
    } catch {
      setMsg("저장 실패");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>LLM (OpenAI 호환) 키</CardTitle>
        <CardDescription>
          OpenAI는 API 접근에 OAuth가 없어 API 키를 사용합니다. 여기에 입력하면 .env 편집 없이 저장되어 메일 분류·제안서
          생성에 적용됩니다. (MiMo 등 호환 엔드포인트는 Base URL로 지정)
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2 text-sm">
          <span
            className={`inline-block h-2.5 w-2.5 rounded-full ${status?.configured ? "bg-green-500" : "bg-red-500"}`}
          />
          <span>
            {status?.configured
              ? `설정됨 (${status.source === "env" ? ".env" : "웹 저장"}) · 키 ${status.keyMasked ?? "•••"}`
              : "미설정 — 규칙 기반 분류 사용 중"}
          </span>
        </div>

        <label className="block text-sm">
          <span className="text-muted-foreground">API Key</span>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={status?.configured ? "변경할 때만 입력 (현재 값 유지)" : "sk-… / tp-…"}
            className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
            autoComplete="off"
          />
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="text-muted-foreground">Base URL (선택)</span>
            <input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.openai.com/v1"
              className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
            />
          </label>
          <label className="block text-sm">
            <span className="text-muted-foreground">Model</span>
            <input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="gpt-4o-mini"
              className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
            />
          </label>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={save}
            disabled={saving}
            className="inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {saving ? "저장 중…" : "저장"}
          </button>
          {msg && <span className="text-sm text-muted-foreground">{msg}</span>}
        </div>
      </CardContent>
    </Card>
  );
}

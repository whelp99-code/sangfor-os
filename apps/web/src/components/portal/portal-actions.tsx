"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { actionErrorMessage } from "@/lib/action-error-labels";

export function PortalActions() {
  const [accountId, setAccountId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  async function connect() {
    setStatus(null);
    const response = await fetch("/api/portal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "connect-outlook", projectSlug: "demo-project" }),
    });
    const data = await response.json();
    if (!response.ok) {
      setStatus(actionErrorMessage(data.error, actionErrorMessage("connect_failed")));
      return;
    }
    setAccountId(data.account.id);
    setStatus("Outlook 목업 계정을 연결했습니다");
  }

  async function syncMail() {
    if (!accountId) {
      setStatus("먼저 Outlook을 연결하세요");
      return;
    }
    const response = await fetch("/api/portal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "sync-mail", accountId }),
    });
    const data = await response.json();
    if (!response.ok) {
      setStatus(actionErrorMessage(data.error, actionErrorMessage("sync_failed")));
      return;
    }
    setStatus(`메일 ${data.messages.length}건을 동기화했습니다`);
    window.location.reload();
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="secondary" onClick={connect}>
        Outlook 연결 (목업)
      </Button>
      <Button variant="outline" onClick={syncMail}>
        메일 동기화
      </Button>
      {status ? <span className="text-sm text-muted-foreground">{status}</span> : null}
    </div>
  );
}

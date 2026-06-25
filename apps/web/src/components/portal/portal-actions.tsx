"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";

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
      setStatus(data.error ?? "connect_failed");
      return;
    }
    setAccountId(data.account.id);
    setStatus("Outlook mock connected");
  }

  async function syncMail() {
    if (!accountId) {
      setStatus("Connect Outlook first");
      return;
    }
    const response = await fetch("/api/portal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "sync-mail", accountId }),
    });
    const data = await response.json();
    if (!response.ok) {
      setStatus(data.error ?? "sync_failed");
      return;
    }
    setStatus(`Synced ${data.messages.length} messages`);
    window.location.reload();
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="secondary" onClick={connect}>
        Connect Outlook (mock)
      </Button>
      <Button variant="outline" onClick={syncMail}>
        Sync mail
      </Button>
      {status ? <span className="text-sm text-muted-foreground">{status}</span> : null}
    </div>
  );
}

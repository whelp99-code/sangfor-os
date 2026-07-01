"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { actionErrorMessage } from "@/lib/action-error-labels";

type Props = {
  candidateId?: string;
  status?: string;
  requiresAiCheck?: boolean;
};

export function GenerateMailCandidatesButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function generate() {
    setLoading(true);
    setMessage(null);
    const res = await fetch("/api/mail-candidates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ limit: 50 }),
    });
    const data = await res.json();
    if (res.ok) {
      setMessage(`Created ${data.created}, skipped ${data.skipped}, scanned ${data.scanned}`);
      router.refresh();
    } else {
      setMessage(actionErrorMessage(data.error, actionErrorMessage("generate_failed")));
    }
    setLoading(false);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button disabled={loading} onClick={generate} type="button">
        {loading ? "Generating…" : "Generate from mail"}
      </Button>
      {message ? <span className="text-xs text-muted-foreground">{message}</span> : null}
    </div>
  );
}

export function MailCandidateActions({ candidateId, status, requiresAiCheck = false }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reasonCode, setReasonCode] = useState("weak_evidence");

  async function patch(action: "approve" | "reject" | "revalidate") {
    if (!candidateId) return;
    setLoading(action);
    setError(null);
    const res = await fetch(`/api/mail-candidates/${candidateId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...(action === "reject" ? { reasonCode } : {}) }),
    });
    if (res.ok) {
      router.refresh();
    } else {
      const data = await res.json();
      setError(actionErrorMessage(data.error, actionErrorMessage("patch_failed")));
    }
    setLoading(null);
  }

  if (status !== "proposed" && status !== "needs_revalidation") return null;

  if (status === "needs_revalidation" || requiresAiCheck) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          disabled={loading != null}
          onClick={() => patch("revalidate")}
          type="button"
        >
          {loading === "revalidate" ? "Checking…" : "Run AI check"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={loading != null}
          onClick={() => patch("reject")}
          type="button"
        >
          {loading === "reject" ? "Rejecting…" : "Reject"}
        </Button>
        <RejectReasonSelect value={reasonCode} onChange={setReasonCode} />
        {error ? <span className="text-xs text-destructive">{error}</span> : null}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" disabled={loading != null} onClick={() => patch("approve")} type="button">
        {loading === "approve" ? "Creating…" : "Approve & create"}
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={loading != null}
        onClick={() => patch("reject")}
        type="button"
      >
        {loading === "reject" ? "Rejecting…" : "Reject"}
      </Button>
      <RejectReasonSelect value={reasonCode} onChange={setReasonCode} />
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </div>
  );
}

function RejectReasonSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <select
      className="h-8 rounded-md border bg-background px-2 text-xs"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      aria-label="Reject reason"
    >
      <option value="weak_evidence">Weak evidence</option>
      <option value="internal_company">Internal company</option>
      <option value="system_sender">System sender</option>
      <option value="duplicate">Duplicate</option>
      <option value="wrong_entity_role">Wrong entity role</option>
      <option value="not_actionable">Not actionable</option>
    </select>
  );
}

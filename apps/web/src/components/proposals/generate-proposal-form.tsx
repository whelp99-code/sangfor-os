"use client";

import { PROPOSAL_TEMPLATE_KEYS } from "@sangfor/shared";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Option = { id: string; label: string };

export function GenerateProposalForm({
  customers,
  pocProjects,
}: {
  customers: Option[];
  pocProjects: Option[];
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [templateKey, setTemplateKey] = useState<string>(PROPOSAL_TEMPLATE_KEYS[0]);
  const [customerId, setCustomerId] = useState("");
  const [pocProjectId, setPocProjectId] = useState("");
  const [scope, setScope] = useState("");
  const [timeline, setTimeline] = useState("");
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMessage(null);
    const variables: Record<string, string> = {};
    if (scope) variables.scope = scope;
    if (timeline) variables.timeline = timeline;
    if (amount) variables.amount = amount;

    const res = await fetch("/api/proposals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        templateKey,
        projectSlug: "demo-project",
        customerId: customerId || undefined,
        pocProjectId: pocProjectId || undefined,
        variables,
      }),
    });
    const data = await res.json();
    setLoading(false);
    if (res.ok) {
      router.push(`/proposals/${data.document.id}`);
      router.refresh();
    } else {
      setMessage(data.error ?? "Generation failed");
    }
  }

  return (
    <form className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3" onSubmit={onSubmit}>
      <Input placeholder="Document title" value={title} onChange={(e) => setTitle(e.target.value)} required />
      <select
        className="h-9 rounded-md border bg-background px-2 text-sm"
        value={templateKey}
        onChange={(e) => setTemplateKey(e.target.value)}
      >
        {PROPOSAL_TEMPLATE_KEYS.map((k) => (
          <option key={k} value={k}>{k}</option>
        ))}
      </select>
      <select
        className="h-9 rounded-md border bg-background px-2 text-sm"
        value={customerId}
        onChange={(e) => setCustomerId(e.target.value)}
      >
        <option value="">Customer (optional)</option>
        {customers.map((c) => (
          <option key={c.id} value={c.id}>{c.label}</option>
        ))}
      </select>
      <select
        className="h-9 rounded-md border bg-background px-2 text-sm"
        value={pocProjectId}
        onChange={(e) => setPocProjectId(e.target.value)}
      >
        <option value="">PoC (optional)</option>
        {pocProjects.map((p) => (
          <option key={p.id} value={p.id}>{p.label}</option>
        ))}
      </select>
      <Input placeholder="Scope override (optional)" value={scope} onChange={(e) => setScope(e.target.value)} />
      <Input placeholder="Timeline override (optional)" value={timeline} onChange={(e) => setTimeline(e.target.value)} />
      <Input placeholder="Amount override (optional)" value={amount} onChange={(e) => setAmount(e.target.value)} />
      <Button type="submit" disabled={loading} className="sm:col-span-2 lg:col-span-1">
        {loading ? "Generating..." : "Generate"}
      </Button>
      {message ? <p className="text-sm text-destructive sm:col-span-2 lg:col-span-3">{message}</p> : null}
    </form>
  );
}

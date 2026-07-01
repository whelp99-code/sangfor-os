"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { OPPORTUNITY_STAGES } from "@/lib/poc-constants";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Option = { id: string; label: string };

function toIsoDate(date: string): string | undefined {
  if (!date) return undefined;
  return new Date(`${date}T12:00:00.000Z`).toISOString();
}

export function CreateOpportunityForm({
  customers,
  partners,
}: {
  customers: Option[];
  partners: Option[];
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [partnerId, setPartnerId] = useState("");
  const [stage, setStage] = useState<string>("lead");
  const [amount, setAmount] = useState("");
  const [probability, setProbability] = useState("20");
  const [closeDate, setCloseDate] = useState("");
  const [nextAction, setNextAction] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const res = await fetch("/api/opportunities", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        projectSlug: "demo-project",
        stage,
        customerId: customerId || undefined,
        partnerId: partnerId || undefined,
        amount: amount ? Number(amount) : undefined,
        probability: Number(probability),
        closeDate: toIsoDate(closeDate),
        nextAction: nextAction || undefined,
      }),
    });
    const data = await res.json();
    setLoading(false);
    if (res.ok) {
      router.push(`/opportunities/${data.opportunity.id}`);
      router.refresh();
    }
  }

  return (
    <form className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4" onSubmit={onSubmit}>
      <Input aria-label="Opportunity title" placeholder="Opportunity title" value={title} onChange={(e) => setTitle(e.target.value)} required />
      <select
        aria-label="Customer (optional)"
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
        aria-label="Partner (optional)"
        className="h-9 rounded-md border bg-background px-2 text-sm"
        value={partnerId}
        onChange={(e) => setPartnerId(e.target.value)}
      >
        <option value="">Partner (optional)</option>
        {partners.map((p) => (
          <option key={p.id} value={p.id}>{p.label}</option>
        ))}
      </select>
      <select
        aria-label="Stage"
        className="h-9 rounded-md border bg-background px-2 text-sm"
        value={stage}
        onChange={(e) => setStage(e.target.value)}
      >
        {OPPORTUNITY_STAGES.map((s) => (
          <option key={s} value={s}>{s}</option>
        ))}
      </select>
      <Input aria-label="Amount" type="number" placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} />
      <Input aria-label="Probability %" type="number" min={0} max={100} placeholder="Probability %" value={probability} onChange={(e) => setProbability(e.target.value)} />
      <Input aria-label="Close date" type="date" value={closeDate} onChange={(e) => setCloseDate(e.target.value)} />
      <Input aria-label="Next action" placeholder="Next action" value={nextAction} onChange={(e) => setNextAction(e.target.value)} />
      <Button type="submit" disabled={loading} className="sm:col-span-2 lg:col-span-1">
        {loading ? "Creating..." : "New opportunity"}
      </Button>
    </form>
  );
}

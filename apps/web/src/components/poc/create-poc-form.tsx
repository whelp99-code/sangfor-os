"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  POC_DEPLOYMENT_TYPES,
  POC_PRODUCT_LINES,
} from "@/lib/poc-constants";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Option = { id: string; label: string };

function toIsoDateTime(date: string): string | undefined {
  if (!date) return undefined;
  return new Date(`${date}T09:00:00.000Z`).toISOString();
}

export function CreatePocForm({
  customers,
  partners,
}: {
  customers: Option[];
  partners: Option[];
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [productName, setProductName] = useState("Sangfor HCI");
  const [productLine, setProductLine] = useState("");
  const [deploymentType, setDeploymentType] = useState("");
  const [hwSpec, setHwSpec] = useState("");
  const [swSpec, setSwSpec] = useState("");
  const [networkNotes, setNetworkNotes] = useState("");
  const [scheduleAt, setScheduleAt] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [partnerId, setPartnerId] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const res = await fetch("/api/poc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        productName,
        productLine: productLine || undefined,
        deploymentType: deploymentType || undefined,
        hwSpec: hwSpec || undefined,
        swSpec: swSpec || undefined,
        networkNotes: networkNotes || undefined,
        scheduleAt: toIsoDateTime(scheduleAt),
        customerId: customerId || undefined,
        partnerId: partnerId || undefined,
        projectSlug: "demo-project",
      }),
    });
    const data = await res.json();
    setLoading(false);
    if (res.ok) {
      router.push(`/poc/${data.project.id}`);
      router.refresh();
    }
  }

  return (
    <form className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4" onSubmit={onSubmit}>
      <Input aria-label="PoC title" placeholder="PoC title" value={title} onChange={(e) => setTitle(e.target.value)} required />
      <Input aria-label="Product name" placeholder="Product name" value={productName} onChange={(e) => setProductName(e.target.value)} />
      <select
        aria-label="Product line"
        className="h-9 rounded-md border bg-background px-2 text-sm"
        value={productLine}
        onChange={(e) => setProductLine(e.target.value)}
      >
        <option value="">Product line</option>
        {POC_PRODUCT_LINES.map((line) => (
          <option key={line} value={line}>{line}</option>
        ))}
      </select>
      <select
        aria-label="Deployment type"
        className="h-9 rounded-md border bg-background px-2 text-sm"
        value={deploymentType}
        onChange={(e) => setDeploymentType(e.target.value)}
      >
        <option value="">Deployment type</option>
        {POC_DEPLOYMENT_TYPES.map((t) => (
          <option key={t} value={t}>{t}</option>
        ))}
      </select>
      <Input aria-label="HW spec" placeholder="HW spec" value={hwSpec} onChange={(e) => setHwSpec(e.target.value)} />
      <Input aria-label="SW spec" placeholder="SW spec" value={swSpec} onChange={(e) => setSwSpec(e.target.value)} />
      <Input aria-label="Network notes" placeholder="Network notes" value={networkNotes} onChange={(e) => setNetworkNotes(e.target.value)} />
      <Input aria-label="Schedule date" type="date" value={scheduleAt} onChange={(e) => setScheduleAt(e.target.value)} />
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
      <Button type="submit" disabled={loading} className="sm:col-span-2 lg:col-span-1">
        {loading ? "Creating..." : "New PoC"}
      </Button>
    </form>
  );
}

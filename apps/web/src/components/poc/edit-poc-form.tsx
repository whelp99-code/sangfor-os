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

function toIsoDateTime(date: string): string | null {
  if (!date) return null;
  return new Date(`${date}T09:00:00.000Z`).toISOString();
}

function formatDateInput(value: Date | string | null | undefined): string {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

export function EditPocForm({
  pocId,
  initial,
  customers,
  partners,
}: {
  pocId: string;
  initial: {
    title: string;
    productName: string | null;
    productLine: string | null;
    deploymentType: string | null;
    hwSpec: string | null;
    swSpec: string | null;
    networkNotes: string | null;
    scheduleAt: Date | null;
    customerId: string | null;
    partnerId: string | null;
  };
  customers: Option[];
  partners: Option[];
}) {
  const router = useRouter();
  const [title, setTitle] = useState(initial.title);
  const [productName, setProductName] = useState(initial.productName ?? "");
  const [productLine, setProductLine] = useState(initial.productLine ?? "");
  const [deploymentType, setDeploymentType] = useState(initial.deploymentType ?? "");
  const [hwSpec, setHwSpec] = useState(initial.hwSpec ?? "");
  const [swSpec, setSwSpec] = useState(initial.swSpec ?? "");
  const [networkNotes, setNetworkNotes] = useState(initial.networkNotes ?? "");
  const [scheduleAt, setScheduleAt] = useState(formatDateInput(initial.scheduleAt));
  const [customerId, setCustomerId] = useState(initial.customerId ?? "");
  const [partnerId, setPartnerId] = useState(initial.partnerId ?? "");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    await fetch(`/api/poc/${pocId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        productName: productName || null,
        productLine: productLine || null,
        deploymentType: deploymentType || null,
        hwSpec: hwSpec || null,
        swSpec: swSpec || null,
        networkNotes: networkNotes || null,
        scheduleAt: toIsoDateTime(scheduleAt),
        customerId: customerId || null,
        partnerId: partnerId || null,
      }),
    });
    setLoading(false);
    router.refresh();
  }

  return (
    <form className="grid gap-2 sm:grid-cols-2" onSubmit={onSubmit}>
      <Input aria-label="PoC 제목" value={title} onChange={(e) => setTitle(e.target.value)} required />
      <Input aria-label="제품명" placeholder="제품명" value={productName} onChange={(e) => setProductName(e.target.value)} />
      <select
        aria-label="제품 라인"
        className="h-9 rounded-md border bg-background px-2 text-sm"
        value={productLine}
        onChange={(e) => setProductLine(e.target.value)}
      >
        <option value="">제품 라인</option>
        {POC_PRODUCT_LINES.map((line) => (
          <option key={line} value={line}>{line}</option>
        ))}
      </select>
      <select
        aria-label="배포 유형"
        className="h-9 rounded-md border bg-background px-2 text-sm"
        value={deploymentType}
        onChange={(e) => setDeploymentType(e.target.value)}
      >
        <option value="">배포 유형</option>
        {POC_DEPLOYMENT_TYPES.map((t) => (
          <option key={t} value={t}>{t}</option>
        ))}
      </select>
      <Input aria-label="HW 사양" placeholder="HW 사양" value={hwSpec} onChange={(e) => setHwSpec(e.target.value)} />
      <Input aria-label="SW 사양" placeholder="SW 사양" value={swSpec} onChange={(e) => setSwSpec(e.target.value)} />
      <Input aria-label="네트워크 메모" placeholder="네트워크 메모" value={networkNotes} onChange={(e) => setNetworkNotes(e.target.value)} />
      <Input aria-label="예정일" type="date" value={scheduleAt} onChange={(e) => setScheduleAt(e.target.value)} />
      <select
        aria-label="고객사"
        className="h-9 rounded-md border bg-background px-2 text-sm"
        value={customerId}
        onChange={(e) => setCustomerId(e.target.value)}
      >
        <option value="">고객사 없음</option>
        {customers.map((c) => (
          <option key={c.id} value={c.id}>{c.label}</option>
        ))}
      </select>
      <select
        aria-label="파트너"
        className="h-9 rounded-md border bg-background px-2 text-sm"
        value={partnerId}
        onChange={(e) => setPartnerId(e.target.value)}
      >
        <option value="">파트너 없음</option>
        {partners.map((p) => (
          <option key={p.id} value={p.id}>{p.label}</option>
        ))}
      </select>
      <Button type="submit" size="sm" disabled={loading} className="sm:col-span-2">
        {loading ? "저장 중..." : "PoC 상세 저장"}
      </Button>
    </form>
  );
}

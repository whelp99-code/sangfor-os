"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function CreateCustomerForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const res = await fetch("/api/customers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, domain, projectSlug: "demo-project" }),
    });
    const data = await res.json();
    setLoading(false);
    if (res.ok) {
      router.push(`/customers/${data.customer.id}`);
      router.refresh();
    }
  }

  return (
    <form className="flex flex-col gap-2 sm:flex-row" onSubmit={onSubmit}>
      <Input aria-label="고객사명" placeholder="고객사명" value={name} onChange={(e) => setName(e.target.value)} required />
      <Input aria-label="도메인 (선택)" placeholder="도메인 (선택)" value={domain} onChange={(e) => setDomain(e.target.value)} />
      <Button type="submit" disabled={loading}>{loading ? "저장 중..." : "고객사 추가"}</Button>
    </form>
  );
}

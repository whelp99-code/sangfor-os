"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { actionErrorMessage } from "@/lib/action-error-labels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function CreateCustomerForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, domain, projectSlug: "demo-project" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(actionErrorMessage((data as { error?: string }).error, "고객사를 추가하지 못했습니다."));
        return;
      }
      router.push(`/customers/${data.customer.id}`);
      router.refresh();
    } catch {
      setError("고객사를 추가하지 못했습니다. 네트워크를 확인해 주세요.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="flex flex-col gap-2 sm:flex-row" onSubmit={onSubmit}>
      <Input aria-label="고객사명" placeholder="고객사명" value={name} onChange={(e) => setName(e.target.value)} required />
      <Input aria-label="도메인 (선택)" placeholder="도메인 (선택)" value={domain} onChange={(e) => setDomain(e.target.value)} />
      <Button type="submit" disabled={loading}>{loading ? "저장 중..." : "고객사 추가"}</Button>
      {error && (
        <p className="w-full text-xs text-destructive sm:basis-full" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

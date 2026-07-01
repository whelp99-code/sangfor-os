"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { actionErrorMessage } from "@/lib/action-error-labels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function CreatePartnerForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [partnerType, setPartnerType] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/partners", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          partnerType: partnerType || undefined,
          projectSlug: "demo-project",
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(actionErrorMessage((data as { error?: string }).error, "파트너를 추가하지 못했습니다."));
        return;
      }
      router.push(`/partners/${data.partner.id}`);
      router.refresh();
    } catch {
      setError("파트너를 추가하지 못했습니다. 네트워크를 확인해 주세요.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="flex flex-col gap-2 sm:flex-row" onSubmit={onSubmit}>
      <Input aria-label="파트너명" placeholder="파트너명" value={name} onChange={(event) => setName(event.target.value)} required />
      <Input aria-label="유형(리셀러·SI 등)" placeholder="유형(리셀러·SI 등)" value={partnerType} onChange={(event) => setPartnerType(event.target.value)} />
      <Button type="submit" disabled={loading}>{loading ? "저장 중..." : "파트너 추가"}</Button>
      {error && (
        <p className="w-full text-xs text-destructive sm:basis-full" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

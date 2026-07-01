"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function CreatePartnerForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [partnerType, setPartnerType] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    const response = await fetch("/api/partners", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        partnerType: partnerType || undefined,
        projectSlug: "demo-project",
      }),
    });
    const data = await response.json();
    setLoading(false);
    if (response.ok) {
      router.push(`/partners/${data.partner.id}`);
      router.refresh();
    }
  }

  return (
    <form className="flex flex-col gap-2 sm:flex-row" onSubmit={onSubmit}>
      <Input aria-label="파트너명" placeholder="파트너명" value={name} onChange={(event) => setName(event.target.value)} required />
      <Input aria-label="유형(리셀러·SI 등)" placeholder="유형(리셀러·SI 등)" value={partnerType} onChange={(event) => setPartnerType(event.target.value)} />
      <Button type="submit" disabled={loading}>{loading ? "저장 중..." : "파트너 추가"}</Button>
    </form>
  );
}

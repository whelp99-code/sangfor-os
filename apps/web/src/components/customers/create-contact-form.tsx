"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function CreateContactForm({ customerId }: { customerId: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    const response = await fetch("/api/contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customerId,
        name,
        email: email || undefined,
        role: role || undefined,
      }),
    });
    setLoading(false);
    if (response.ok) {
      setName("");
      setEmail("");
      setRole("");
      router.refresh();
    }
  }

  return (
    <form className="grid gap-2 md:grid-cols-4" onSubmit={onSubmit}>
      <Input aria-label="담당자명" placeholder="담당자명" value={name} onChange={(event) => setName(event.target.value)} required />
      <Input aria-label="이메일" placeholder="이메일" type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
      <Input aria-label="직책" placeholder="직책" value={role} onChange={(event) => setRole(event.target.value)} />
      <Button type="submit" disabled={loading}>{loading ? "저장 중..." : "담당자 추가"}</Button>
    </form>
  );
}

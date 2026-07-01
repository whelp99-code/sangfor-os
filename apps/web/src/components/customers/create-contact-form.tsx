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
      <Input aria-label="Contact name" placeholder="Contact name" value={name} onChange={(event) => setName(event.target.value)} required />
      <Input aria-label="Email" placeholder="Email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
      <Input aria-label="Role" placeholder="Role" value={role} onChange={(event) => setRole(event.target.value)} />
      <Button type="submit" disabled={loading}>{loading ? "Saving..." : "Add contact"}</Button>
    </form>
  );
}

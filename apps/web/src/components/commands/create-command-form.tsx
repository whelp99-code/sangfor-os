"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { actionErrorMessage } from "@/lib/action-error-labels";

export function CreateCommandForm() {
  const router = useRouter();
  const [inputSummary, setInputSummary] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/commands", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inputSummary }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "create_failed");
      router.push(`/commands/${data.run.id}`);
      router.refresh();
    } catch (err) {
      setError(actionErrorMessage(err instanceof Error ? err.message : "create_failed"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="flex flex-col gap-3 sm:flex-row" onSubmit={onSubmit}>
      <Input
        placeholder="Describe the automation request…"
        value={inputSummary}
        onChange={(e) => setInputSummary(e.target.value)}
        required
        minLength={3}
      />
      <Button type="submit" disabled={loading}>
        {loading ? "Creating…" : "New command run"}
      </Button>
      {error ? <p className="text-sm text-destructive sm:basis-full">{error}</p> : null}
    </form>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function CreateImprovementForm() {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [sourceType, setSourceType] = useState("manual");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    await fetch("/api/improvements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, sourceType }),
    });
    setMessage("");
    setLoading(false);
    router.refresh();
  }

  return (
    <form className="flex flex-col gap-2 sm:flex-row" onSubmit={onSubmit}>
      <Input
        placeholder="Error / failure message"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        required
      />
      <Input
        className="sm:w-40"
        placeholder="sourceType"
        value={sourceType}
        onChange={(e) => setSourceType(e.target.value)}
      />
      <Button disabled={loading} type="submit">
        {loading ? "Creating…" : "Create candidate"}
      </Button>
    </form>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";

export function SaveProposalForm({
  documentId,
  initialBody,
}: {
  documentId: string;
  initialBody: string;
}) {
  const router = useRouter();
  const [bodyMarkdown, setBodyMarkdown] = useState(initialBody);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    await fetch(`/api/proposals/${documentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bodyMarkdown }),
    });
    setLoading(false);
    router.refresh();
  }

  return (
    <form className="space-y-3" onSubmit={onSubmit}>
      <textarea
        className="min-h-[320px] w-full rounded-md border bg-background px-3 py-2 font-mono text-sm"
        value={bodyMarkdown}
        onChange={(e) => setBodyMarkdown(e.target.value)}
      />
      <Button type="submit" disabled={loading}>
        {loading ? "Saving version..." : "Save new version"}
      </Button>
    </form>
  );
}

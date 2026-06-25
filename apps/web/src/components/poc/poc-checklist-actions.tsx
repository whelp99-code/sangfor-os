"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";

type Props = {
  pocId: string;
  items: { id: string; label: string; done: boolean }[];
};

export function PocChecklistActions({ pocId, items }: Props) {
  const [loadingId, setLoadingId] = useState<string | null>(null);

  async function toggle(itemId: string, done: boolean) {
    setLoadingId(itemId);
    await fetch(`/api/poc/${pocId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "toggle_checklist", itemId, done: !done }),
    });
    window.location.reload();
  }

  return (
    <div className="space-y-2 text-sm">
      {items.map((item) => (
        <div key={item.id} className="flex items-center justify-between gap-2">
          <span>{item.label}</span>
          <Button
            size="sm"
            variant={item.done ? "secondary" : "outline"}
            disabled={loadingId === item.id}
            onClick={() => toggle(item.id, item.done)}
          >
            {item.done ? "Reopen" : "Complete"}
          </Button>
        </div>
      ))}
    </div>
  );
}

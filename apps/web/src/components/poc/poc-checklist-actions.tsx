"use client";

import { useState } from "react";

import { actionErrorMessage } from "@/lib/action-error-labels";
import { Button } from "@/components/ui/button";

type Props = {
  pocId: string;
  items: { id: string; label: string; done: boolean }[];
};

export function PocChecklistActions({ pocId, items }: Props) {
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggle(itemId: string, done: boolean) {
    setLoadingId(itemId);
    setError(null);
    try {
      const res = await fetch(`/api/poc/${pocId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "toggle_checklist", itemId, done: !done }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(actionErrorMessage((data as { error?: string }).error, "항목을 변경하지 못했습니다."));
        return;
      }
      window.location.reload();
    } catch {
      setError("항목을 변경하지 못했습니다. 네트워크를 확인해 주세요.");
    } finally {
      setLoadingId(null);
    }
  }

  return (
    <div className="space-y-2 text-sm">
      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">체크리스트 항목이 없습니다.</p>
      ) : (
        items.map((item) => (
          <div key={item.id} className="flex items-center justify-between gap-2">
            <span>{item.label}</span>
            <Button
              size="sm"
              variant={item.done ? "secondary" : "outline"}
              disabled={loadingId === item.id}
              onClick={() => toggle(item.id, item.done)}
            >
              {item.done ? "재개" : "완료"}
            </Button>
          </div>
        ))
      )}
    </div>
  );
}

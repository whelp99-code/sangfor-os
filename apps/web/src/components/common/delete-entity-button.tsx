"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";

type DeleteEntityButtonProps = {
  endpoint: string;
  label?: string;
  redirectTo?: string;
  confirmationMessage?: string;
};

export function DeleteEntityButton({
  endpoint,
  label,
  redirectTo,
  confirmationMessage = "정말 보관할까요? 목록에서 숨겨지며 데이터는 삭제되지 않습니다.",
}: DeleteEntityButtonProps) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    const confirmed = window.confirm(confirmationMessage);
    if (!confirmed) return;

    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(endpoint, { method: "DELETE" });
      if (res.ok) {
        if (redirectTo) {
          router.push(redirectTo);
        } else {
          router.refresh();
        }
      } else {
        setError("보관하지 못했습니다. 잠시 후 다시 시도해 주세요.");
      }
    } catch {
      setError("네트워크 오류로 보관하지 못했습니다.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <Button
        variant="destructive"
        size="sm"
        disabled={deleting}
        onClick={handleClick}
      >
        {label ?? "보관"}
      </Button>
      {error && <span role="alert" className="max-w-56 text-right text-xs text-destructive">{error}</span>}
    </span>
  );
}

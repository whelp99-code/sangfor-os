"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";

type DeleteEntityButtonProps = {
  endpoint: string;
  label?: string;
  redirectTo?: string;
};

export function DeleteEntityButton({
  endpoint,
  label,
  redirectTo,
}: DeleteEntityButtonProps) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);

  async function handleClick() {
    const confirmed = window.confirm(
      "정말 삭제할까요? 이 작업은 되돌릴 수 없습니다."
    );
    if (!confirmed) return;

    setDeleting(true);
    try {
      const res = await fetch(endpoint, { method: "DELETE" });
      if (res.ok) {
        if (redirectTo) {
          router.push(redirectTo);
        } else {
          router.refresh();
        }
      }
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Button
      variant="destructive"
      size="sm"
      disabled={deleting}
      onClick={handleClick}
    >
      {label ?? "삭제"}
    </Button>
  );
}

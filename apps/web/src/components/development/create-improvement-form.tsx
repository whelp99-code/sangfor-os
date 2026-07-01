"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { actionErrorMessage } from "@/lib/action-error-labels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function CreateImprovementForm() {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [sourceType, setSourceType] = useState("manual");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/improvements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, sourceType }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(actionErrorMessage((data as { error?: string }).error, "후보를 생성하지 못했습니다."));
        return;
      }
      setMessage("");
      router.refresh();
    } catch {
      setError("후보를 생성하지 못했습니다. 네트워크를 확인해 주세요.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="flex flex-col gap-2 sm:flex-row" onSubmit={onSubmit}>
      <Input
        aria-label="오류 / 실패 메시지"
        placeholder="오류 / 실패 메시지"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        required
      />
      <Input
        aria-label="sourceType"
        className="sm:w-40"
        placeholder="sourceType"
        value={sourceType}
        onChange={(e) => setSourceType(e.target.value)}
      />
      <Button disabled={loading} type="submit">
        {loading ? "생성 중…" : "후보 생성"}
      </Button>
      {error && (
        <p className="w-full text-xs text-destructive sm:basis-full" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

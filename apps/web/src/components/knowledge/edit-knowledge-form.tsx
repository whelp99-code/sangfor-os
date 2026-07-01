"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { actionErrorMessage } from "@/lib/action-error-labels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function EditKnowledgeForm({
  documentId,
  initial,
}: {
  documentId: string;
  initial: { title: string; body: string; tags: string[]; source: string };
}) {
  const router = useRouter();
  const [title, setTitle] = useState(initial.title);
  const [body, setBody] = useState(initial.body);
  const [tags, setTags] = useState(initial.tags.join(", "));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/knowledge/${documentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          body,
          tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(actionErrorMessage((data as { error?: string }).error, "변경 사항을 저장하지 못했습니다."));
        return;
      }
      router.refresh();
    } catch {
      setError("변경 사항을 저장하지 못했습니다. 네트워크를 확인해 주세요.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="grid gap-2" onSubmit={onSubmit}>
      <Input value={title} onChange={(e) => setTitle(e.target.value)} required />
      <Input placeholder="태그 (쉼표로 구분)" value={tags} onChange={(e) => setTags(e.target.value)} />
      <p className="text-xs text-muted-foreground">출처: {initial.source}</p>
      <textarea
        className="min-h-[200px] rounded-md border bg-background px-3 py-2 text-sm"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        required
      />
      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
      <Button type="submit" disabled={loading}>{loading ? "저장 중..." : "변경 사항 저장"}</Button>
    </form>
  );
}

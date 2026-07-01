"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

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

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    await fetch(`/api/knowledge/${documentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        body,
        tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
      }),
    });
    setLoading(false);
    router.refresh();
  }

  return (
    <form className="grid gap-2" onSubmit={onSubmit}>
      <Input aria-label="Title" value={title} onChange={(e) => setTitle(e.target.value)} required />
      <Input aria-label="Tags (comma-separated)" placeholder="Tags (comma-separated)" value={tags} onChange={(e) => setTags(e.target.value)} />
      <p className="text-xs text-muted-foreground">Source: {initial.source}</p>
      <textarea
        aria-label="Body"
        className="min-h-[200px] rounded-md border bg-background px-3 py-2 text-sm"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        required
      />
      <Button type="submit" disabled={loading}>{loading ? "Saving..." : "Save changes"}</Button>
    </form>
  );
}

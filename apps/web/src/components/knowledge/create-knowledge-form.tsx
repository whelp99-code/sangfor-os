"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function CreateKnowledgeForm() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [tags, setTags] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const res = await fetch("/api/knowledge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        body,
        tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
        projectSlug: "demo-project",
      }),
    });
    const data = await res.json();
    setLoading(false);
    if (res.ok) {
      setTitle("");
      setBody("");
      setTags("");
      router.push(`/knowledge/${data.document.id}`);
    }
  }

  return (
    <form className="grid gap-2" onSubmit={onSubmit}>
      <Input placeholder="제목" value={title} onChange={(e) => setTitle(e.target.value)} required />
      <Input placeholder="태그 (쉼표로 구분)" value={tags} onChange={(e) => setTags(e.target.value)} />
      <textarea
        className="min-h-[80px] rounded-md border bg-background px-3 py-2 text-sm"
        placeholder="본문"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        required
      />
      <Button type="submit" disabled={loading}>{loading ? "저장 중..." : "문서 추가"}</Button>
    </form>
  );
}

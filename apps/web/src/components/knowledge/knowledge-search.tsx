"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

type Citation = {
  documentId: string;
  title: string;
  chunkIndex: number;
  excerpt: string;
  source: string;
};

export function KnowledgeSearch() {
  const [q, setQ] = useState("");
  const [citations, setCitations] = useState<Citation[]>([]);

  async function search(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch(`/api/knowledge?q=${encodeURIComponent(q)}`);
    const data = await res.json();
    setCitations(data.citations ?? []);
  }

  return (
    <div className="space-y-3">
      <form className="flex gap-2" onSubmit={search}>
        <Input placeholder="지식 검색…" value={q} onChange={(e) => setQ(e.target.value)} required />
        <Button type="submit">검색</Button>
      </form>
      {citations.length > 0 ? (
        <ul className="space-y-2 text-sm">
          {citations.map((c) => (
            <li key={`${c.documentId}-${c.chunkIndex}`} className="rounded-md border p-3">
              <div className="mb-1 flex items-center justify-between gap-2">
                <p className="font-medium">{c.title}</p>
                <Badge variant="outline">조각 {c.chunkIndex}</Badge>
              </div>
              <p className="text-muted-foreground">{c.excerpt}</p>
              <p className="mt-1 text-xs text-muted-foreground">출처: {c.source}</p>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

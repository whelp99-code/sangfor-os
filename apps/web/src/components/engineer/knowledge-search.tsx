"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertCircle, BookOpen, RefreshCw, Search } from "lucide-react";
import type { KnowledgeItem, ProductInfo, RagHit } from "@sangfor/infra";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function KnowledgeSearch() {
  // ── RAG search ──
  const [query, setQuery] = useState("");
  const [ragLoading, setRagLoading] = useState(false);
  const [ragError, setRagError] = useState<string | null>(null);
  const [hits, setHits] = useState<RagHit[] | null>(null);

  async function runRag() {
    if (!query.trim() || ragLoading) return;
    setRagLoading(true);
    setRagError(null);
    try {
      const res = await fetch("/api/engineer/rag", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: query.trim() }),
      });
      const json = await res.json();
      if (!res.ok) setRagError(json.error ?? `HTTP ${res.status}`);
      setHits(json.results ?? []);
    } catch (e) {
      setRagError(e instanceof Error ? e.message : "검색 실패");
      setHits([]);
    } finally {
      setRagLoading(false);
    }
  }

  // ── Knowledge browse ──
  const [products, setProducts] = useState<ProductInfo[]>([]);
  const [product, setProduct] = useState("HCI");
  const [type, setType] = useState("manual");
  const [items, setItems] = useState<KnowledgeItem[] | null>(null);
  const [kbLoading, setKbLoading] = useState(false);
  const [kbError, setKbError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/engineer/products", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setProducts(j.products ?? []))
      .catch(() => undefined);
  }, []);

  const loadKnowledge = useCallback(async () => {
    setKbLoading(true);
    setKbError(null);
    try {
      const res = await fetch(
        `/api/engineer/knowledge?product=${encodeURIComponent(product)}&type=${encodeURIComponent(type)}`,
        { cache: "no-store" },
      );
      const json = await res.json();
      if (!res.ok) setKbError(json.error ?? `HTTP ${res.status}`);
      setItems(json.items ?? []);
    } catch (e) {
      setKbError(e instanceof Error ? e.message : "불러오기 실패");
      setItems([]);
    } finally {
      setKbLoading(false);
    }
  }, [product, type]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">지식 검색</h1>
        <p className="text-muted-foreground">
          Engineer 콘솔의 RAG 검색·제품 매뉴얼을 포털에서 직접 조회합니다.
        </p>
      </div>

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
        {/* RAG search */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Search className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              RAG 검색
            </CardTitle>
            <CardDescription>제품 문서를 의미 기반으로 검색합니다.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && runRag()}
                placeholder="예: NGAF HA 구성"
                aria-label="RAG 검색어"
                className="flex-1 rounded-md border border-input bg-background px-2.5 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
              <Button size="sm" onClick={runRag} disabled={ragLoading || !query.trim()}>
                {ragLoading ? <RefreshCw className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : "검색"}
              </Button>
            </div>
            {ragError && (
              <p role="alert" className="flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400">
                <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" /> {ragError}
              </p>
            )}
            {hits && hits.length === 0 && !ragError && (
              <p className="py-4 text-center text-xs text-muted-foreground">결과가 없습니다.</p>
            )}
            {hits && hits.length > 0 && (
              <ul className="space-y-2" aria-label="검색 결과">
                {hits.map((h, i) => (
                  <li key={h.id ?? i} className="rounded-md border border-border p-2.5">
                    <div className="flex items-center gap-2">
                      {h.source && <Badge variant="outline" className="text-[10px]">{h.source}</Badge>}
                      {typeof h.score === "number" && (
                        <span className="font-mono text-[11px] text-muted-foreground">{h.score.toFixed(2)}</span>
                      )}
                    </div>
                    <p className="mt-1 text-xs leading-relaxed">{h.text}</p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Knowledge browse */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <BookOpen className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              매뉴얼 브라우저
            </CardTitle>
            <CardDescription>제품·유형별 매뉴얼/위키 섹션을 조회합니다.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-1 text-xs">
                제품
                <select
                  value={product}
                  onChange={(e) => setProduct(e.target.value)}
                  className="rounded-md border border-input bg-background px-2.5 py-1.5 text-sm"
                >
                  {products.length === 0 && <option value="HCI">HCI</option>}
                  {products.map((p) => (
                    <option key={p.id ?? p.name} value={p.name ?? p.id}>
                      {p.name ?? p.id}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs">
                유형
                <select
                  value={type}
                  onChange={(e) => setType(e.target.value)}
                  className="rounded-md border border-input bg-background px-2.5 py-1.5 text-sm"
                >
                  <option value="manual">manual</option>
                  <option value="wiki">wiki</option>
                </select>
              </label>
              <Button size="sm" variant="outline" onClick={loadKnowledge} disabled={kbLoading}>
                {kbLoading ? <RefreshCw className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : "조회"}
              </Button>
            </div>
            {kbError && (
              <p role="alert" className="flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400">
                <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" /> {kbError}
              </p>
            )}
            {items && items.length === 0 && !kbError && (
              <p className="py-4 text-center text-xs text-muted-foreground">조회 결과가 없습니다.</p>
            )}
            {items && items.length > 0 && (
              <ul className="space-y-2" aria-label="매뉴얼 섹션">
                {items.map((it, i) => (
                  <li key={i} className="rounded-md border border-border p-2.5">
                    <p className="text-xs font-semibold">{it.title ?? it.section}</p>
                    {it.content && <p className="mt-1 line-clamp-3 text-xs text-muted-foreground">{it.content}</p>}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CatalogImportForm } from "./catalog-import-form";

export function CatalogWorkspace() {
  const [products, setProducts] = useState<any[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [showImport, setShowImport] = useState(false);

  const loadProducts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/catalog/products");
      if (res.ok) {
        const data = await res.json();
        setProducts(data.products || []);
      }
    } catch {
      // Ignore network errors in client preview
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/catalog/products/${id}`);
      if (res.ok) {
        const data = await res.json();
        setDetail(data.product);
      }
    } catch {
      // Ignore
    }
  }, []);

  useEffect(() => {
    loadProducts();
  }, [loadProducts]);

  useEffect(() => {
    if (selectedId) {
      loadDetail(selectedId);
    } else {
      setDetail(null);
    }
  }, [selectedId, loadDetail]);

  const handleArchive = async (prod: any) => {
    const key = `archive-ui-${Date.now()}`;
    const res = await fetch(`/api/catalog/products/${prod.id}`, {
      method: "DELETE",
      headers: {
        "content-type": "application/json",
        "idempotency-key": key,
      },
      body: JSON.stringify({
        expectedUpdatedAt: prod.updatedAt,
      }),
    });
    if (res.ok) {
      loadProducts();
      if (selectedId === prod.id) loadDetail(prod.id);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold">상품 & SKU 카탈로그 레지스트리</h1>
          <p className="text-xs text-muted-foreground">
            Product Family, Edition, License Metric, SKU 생애주기 관리
          </p>
        </div>
        <Button
          size="sm"
          variant={showImport ? "secondary" : "default"}
          onClick={() => setShowImport(!showImport)}
        >
          {showImport ? "목록 보기" : "JSON 가져오기"}
        </Button>
      </div>

      {showImport ? (
        <CatalogImportForm
          onImportSuccess={() => {
            setShowImport(false);
            loadProducts();
          }}
        />
      ) : (
        <div className="grid gap-6 md:grid-cols-3">
          {/* Products List */}
          <Card className="md:col-span-1 border border-border shadow-sm">
            <CardHeader className="p-4 border-b border-border">
              <CardTitle className="text-sm font-semibold flex justify-between items-center">
                <span>상품 패밀리 ({products.length})</span>
                {loading && <span className="text-xs text-muted-foreground">로딩 중...</span>}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-2 space-y-1 max-h-[600px] overflow-y-auto">
              {products.length === 0 ? (
                <p className="text-xs text-muted-foreground p-3 italic">등록된 카탈로그가 없습니다.</p>
              ) : (
                products.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setSelectedId(p.id)}
                    className={`w-full text-left p-3 rounded text-xs space-y-1 transition-colors ${
                      selectedId === p.id ? "bg-accent text-accent-foreground font-medium" : "hover:bg-muted/50"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold">{p.name}</span>
                      <Badge variant={p.status === "archived" ? "secondary" : "default"} className="text-[10px] px-1.5">
                        {p.status || "active"}
                      </Badge>
                    </div>
                    <div className="text-[11px] text-muted-foreground flex justify-between">
                      <span>{p.vendor}</span>
                      <span className="font-mono">{p.category || "Uncategorized"}</span>
                    </div>
                  </button>
                ))
              )}
            </CardContent>
          </Card>

          {/* Product Detail */}
          <Card className="md:col-span-2 border border-border shadow-sm">
            <CardHeader className="p-4 border-b border-border">
              <CardTitle className="text-sm font-semibold">
                {detail ? detail.name : "상세 정보"}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4">
              {!detail ? (
                <p className="text-xs text-muted-foreground italic">좌측 목록에서 상품을 선택하세요.</p>
              ) : (
                <div className="space-y-6 text-xs">
                  {/* Summary */}
                  <div className="grid grid-cols-2 gap-4 p-3 bg-muted/40 rounded border border-border">
                    <div>
                      <span className="text-muted-foreground block text-[11px]">Vendor</span>
                      <span className="font-medium">{detail.vendor}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground block text-[11px]">Family Key</span>
                      <span className="font-mono font-medium">{detail.familyKey || "-"}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground block text-[11px]">Category</span>
                      <span>{detail.category || "-"}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground block text-[11px]">Status</span>
                      <Badge variant={detail.status === "archived" ? "secondary" : "default"}>
                        {detail.status || "active"}
                      </Badge>
                    </div>
                  </div>

                  {/* Description */}
                  {detail.description && (
                    <div>
                      <h4 className="font-semibold mb-1">설명</h4>
                      <p className="text-muted-foreground">{detail.description}</p>
                    </div>
                  )}

                  {/* License Metrics */}
                  <div>
                    <h4 className="font-semibold mb-2">License Metrics ({detail.licenseMetrics?.length || 0})</h4>
                    <div className="space-y-1">
                      {detail.licenseMetrics?.map((m: any) => (
                        <div key={m.id} className="p-2 border border-border rounded flex justify-between items-center font-mono">
                          <span>{m.name} ({m.key})</span>
                          <Badge variant="outline">{m.unit}</Badge>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Editions & SKUs */}
                  <div>
                    <h4 className="font-semibold mb-2">Editions & SKUs ({detail.editions?.length || 0} 에디션)</h4>
                    <div className="space-y-4">
                      {detail.editions?.map((ed: any) => (
                        <div key={ed.id} className="border border-border rounded p-3 space-y-2">
                          <div className="flex justify-between items-center font-medium">
                            <span>{ed.name} (v{ed.version})</span>
                            <span className="font-mono text-[11px] text-muted-foreground">{ed.editionKey}</span>
                          </div>
                          <div className="space-y-1">
                            {ed.skus?.map((sku: any) => (
                              <div key={sku.id} className="p-2 bg-muted/30 rounded flex justify-between items-center text-[11px] font-mono">
                                <div>
                                  <span className="font-semibold text-primary">{sku.skuCode}</span>
                                  <span className="ml-2 text-muted-foreground">{sku.name}</span>
                                </div>
                                <div className="space-x-2">
                                  {sku.unitPrice != null && <span className="text-emerald-600 font-semibold">${sku.unitPrice}</span>}
                                  {sku.unitCost != null && <span className="text-amber-600">(원가: ${sku.unitCost})</span>}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Actions */}
                  {detail.status !== "archived" && (
                    <div className="pt-2 flex justify-end">
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        onClick={() => handleArchive(detail)}
                      >
                        상품 보존 아카이브 (Archive)
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

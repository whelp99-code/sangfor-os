"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatKRWShort } from "@/lib/format-krw";

export type QuoteEditorLine = {
  id: string;
  lineType: "product" | "service";
  description: string | null;
  quantity: number;
  unitPrice: string;
  discountPct: string;
  revenue: string;
  cost: string;
  marginPct: string;
  skuCode: string | null;
  sourceCostStatus: string | null;
};

export type QuoteEditorSnapshot = {
  calculatedRevenue: string;
  calculatedCost: string;
  calculatedMarginPct: string;
  costCoverageStatus: string;
  requiresApproval: boolean;
};

export type QuoteEditorProps = {
  quoteId: string;
  version: number;
  status: string;
  currency: string;
  contentHash: string;
  lines: QuoteEditorLine[];
  commercialSnapshot: QuoteEditorSnapshot | null;
  approvalStatus?: string | null;
};

const STATUS_LABEL: Record<string, string> = {
  draft: "초안",
  ready_for_approval: "승인 요청",
  approved: "승인",
  rejected: "반려",
};

const COST_COVERAGE_LABEL: Record<string, string> = {
  complete: "원가 완전",
  auto_failed: "원가 미충족",
  partial: "부분 충족",
};

export function QuoteEditor({
  quoteId,
  version,
  status,
  currency,
  contentHash,
  lines,
  commercialSnapshot,
  approvalStatus,
}: QuoteEditorProps) {
  return (
    <div className="space-y-4" data-testid="quote-editor">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-bold">
            견적서 <span className="font-mono text-xs text-muted-foreground">{quoteId.slice(-8).toUpperCase()}</span>
          </h3>
          <Badge variant="outline" className="text-xs">v{version}</Badge>
          <Badge variant={status === "approved" ? "default" : "secondary"} className="text-xs">
            {STATUS_LABEL[status] ?? status}
          </Badge>
        </div>
        <span className="font-mono text-[10px] text-muted-foreground" title={contentHash}>
          {contentHash.slice(0, 12)}…
        </span>
      </div>

      {lines.length === 0 ? (
        <Card>
          <CardContent className="py-6 text-center text-sm text-muted-foreground">
            라인 아이템이 없습니다.
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm" data-testid="quote-line-items">
            <thead>
              <tr className="border-b bg-muted/40 text-xs text-muted-foreground">
                <th className="px-3 py-2 text-left font-semibold">유형</th>
                <th className="px-3 py-2 text-left font-semibold">설명</th>
                <th className="px-3 py-2 text-right font-semibold">수량</th>
                <th className="px-3 py-2 text-right font-semibold">단가</th>
                <th className="px-3 py-2 text-right font-semibold">할인%</th>
                <th className="px-3 py-2 text-right font-semibold">매출</th>
                <th className="px-3 py-2 text-right font-semibold">원가</th>
                <th className="px-3 py-2 text-right font-semibold">마진%</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.id} className="border-b last:border-0 hover:bg-muted/20">
                  <td className="px-3 py-2">
                    <Badge variant={line.lineType === "product" ? "default" : "outline"} className="text-[10px]">
                      {line.lineType === "product" ? "제품" : "서비스"}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {line.description ?? line.skuCode ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{line.quantity}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatKRWShort(Number(line.unitPrice))}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{Number(line.discountPct).toFixed(1)}%</td>
                  <td className="px-3 py-2 text-right tabular-nums font-medium">{formatKRWShort(Number(line.revenue))}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{formatKRWShort(Number(line.cost))}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{Number(line.marginPct).toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {commercialSnapshot && (
        <Card data-testid="quote-commercial-status">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-muted-foreground font-normal">상업 스냅샷</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div>
                <p className="text-[10px] text-muted-foreground">총 매출</p>
                <p className="text-sm font-bold tabular-nums">{formatKRWShort(Number(commercialSnapshot.calculatedRevenue))}</p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground">총 원가</p>
                <p className="text-sm font-bold tabular-nums">{formatKRWShort(Number(commercialSnapshot.calculatedCost))}</p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground">마진율</p>
                <p className="text-sm font-bold tabular-nums">{Number(commercialSnapshot.calculatedMarginPct).toFixed(1)}%</p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground">원가 커버리지</p>
                <Badge
                  variant={commercialSnapshot.costCoverageStatus === "auto_failed" ? "destructive" : "secondary"}
                  className="text-[10px]"
                  data-testid="cost-coverage-status"
                >
                  {COST_COVERAGE_LABEL[commercialSnapshot.costCoverageStatus] ?? commercialSnapshot.costCoverageStatus}
                </Badge>
              </div>
            </div>

            {commercialSnapshot.requiresApproval && (
              <div className="mt-3 flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
                <span>⚠</span>
                <span>상업 승인 필요 — 마진율 또는 할인율 임계값 초과</span>
              </div>
            )}

            {approvalStatus && (
              <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground" data-testid="approval-status">
                <span>승인 상태:</span>
                <Badge variant="outline" className="text-[10px]">{approvalStatus}</Badge>
              </div>
            )}

            <p className="mt-3 text-[10px] text-muted-foreground" data-testid="release-status">
              내부 릴리스: <span className="font-medium">pending U055</span> — governed release 대기 중
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

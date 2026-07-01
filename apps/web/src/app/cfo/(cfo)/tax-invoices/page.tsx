"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { CfoPageHeading } from "@/components/cfo/page-heading";
import { CFO } from "@/lib/cfo-theme";

/* ── helpers ─────────────────────────────────────────── */
const won = (v: number | null | undefined) =>
  `₩${(v ?? 0).toLocaleString()}`;

const koDate = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleDateString("ko-KR") : "-";

/* ── types ───────────────────────────────────────────── */
type TaxInvoice = {
  id: string;
  direction: "purchase" | "sales";
  supplierName?: string;
  buyerName?: string;
  issueId?: string;
  issueDate?: string;
  supplyAmount?: number;
  vatAmount?: number;
  totalAmount?: number;
  status?: string;
};

type UploadStatus =
  | "created"
  | "duplicate"
  | "skipped_not_ours"
  | "failed"
  | null;

type LineItem = { name: string; amount: string };

/* ── status badge ────────────────────────────────────── */
function StatusBadge({ status }: { status: string | undefined }) {
  const label =
    status === "received"
      ? "받음"
      : status === "ledger_failed"
        ? "원장오류"
        : status === "transmitted"
          ? "전송완료"
          : status === "draft"
            ? "초안"
            : status === "pending_manual"
              ? "수동대기"
              : (status ?? "-");
  const color =
    status === "received"
      ? CFO.inflow
      : status === "transmitted"
        ? CFO.inflow
        : status === "ledger_failed" || status === "failed"
          ? CFO.outflow
          : CFO.brass;
  return (
    <span
      className="inline-block whitespace-nowrap rounded px-2 py-0.5 text-xs font-medium"
      style={{ color, background: `${color}1A` }}
    >
      {label}
    </span>
  );
}

/* ── table shell ─────────────────────────────────────── */
type Col = {
  key: string;
  label: string;
  format?: (val: unknown, row: TaxInvoice) => React.ReactNode;
};

function TaxTable({
  rows,
  cols,
  loading,
  extra,
}: {
  rows: TaxInvoice[];
  cols: Col[];
  loading: boolean;
  extra?: (row: TaxInvoice) => React.ReactNode;
}) {
  return (
    <div
      className="overflow-x-auto rounded-xl border"
      style={{ borderColor: CFO.hairline, background: "#fff" }}
    >
      <table className="w-full text-sm">
        <thead>
          <tr
            style={{ borderBottom: `1px solid ${CFO.hairline}`, color: CFO.muted }}
          >
            {cols.map((c) => (
              <th
                key={c.key}
                className="p-3 text-left text-[11px] font-medium uppercase tracking-wide"
              >
                {c.label}
              </th>
            ))}
            {extra && (
              <th className="p-3 text-right text-[11px] font-medium uppercase tracking-wide">
                액션
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td
                colSpan={cols.length + (extra ? 1 : 0)}
                className="p-4 text-center"
                style={{ color: CFO.muted }}
              >
                로딩 중...
              </td>
            </tr>
          ) : rows.length === 0 ? (
            <tr>
              <td
                colSpan={cols.length + (extra ? 1 : 0)}
                className="p-4 text-center"
                style={{ color: CFO.muted }}
              >
                데이터가 없습니다
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr
                key={row.id}
                className="transition-colors"
                style={{ borderBottom: `1px solid ${CFO.hairline}` }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.background = CFO.paper)
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.background = "transparent")
                }
              >
                {cols.map((c) => (
                  <td key={c.key} className="p-3 tabular-nums">
                    {c.format
                      ? c.format(row[c.key as keyof TaxInvoice], row)
                      : (row[c.key as keyof TaxInvoice] as React.ReactNode) ?? "-"}
                  </td>
                ))}
                {extra && (
                  <td className="p-3 text-right">{extra(row)}</td>
                )}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

/* ── Section rule ────────────────────────────────────── */
function SectionRule({ title }: { title: string }) {
  return (
    <div>
      <h2
        className="text-lg font-semibold tracking-tight"
        style={{ color: CFO.ink }}
      >
        {title}
      </h2>
      <div className="mt-1 h-px w-full" style={{ background: CFO.hairline }} />
      <div className="h-0.5 w-16" style={{ background: CFO.brass }} />
    </div>
  );
}

/* ══════════════════════════════════════════════════════
   PURCHASE SECTION
══════════════════════════════════════════════════════ */
function PurchaseSection() {
  const [rows, setRows] = useState<TaxInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [htmlInput, setHtmlInput] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<{
    status: UploadStatus;
    taxInvoiceId?: string;
  } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const fetchPurchase = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/finance/tax-invoices?direction=purchase");
      if (!res.ok) throw new Error("조회 실패");
      const json = await res.json();
      setRows(Array.isArray(json) ? json : []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchPurchase();
  }, [fetchPurchase]);

  const handleFileRead = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setHtmlInput((ev.target?.result as string) ?? "");
    reader.readAsText(file);
  };

  const handleUpload = async () => {
    const html = htmlInput.trim();
    if (!html) return;
    setUploading(true);
    setUploadResult(null);
    try {
      const res = await fetch("/api/finance/tax-invoices/upload-html", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ html }),
      });
      const json = await res.json();
      setUploadResult(json);
      if (json.status === "created") {
        setHtmlInput("");
        void fetchPurchase();
      }
    } catch {
      setUploadResult({ status: "failed" });
    } finally {
      setUploading(false);
    }
  };

  const uploadResultLabel: Record<string, string> = {
    created: "✓ 등록 완료",
    duplicate: "이미 등록된 세금계산서입니다",
    skipped_not_ours: "수신인이 본사가 아닙니다 (건너뜀)",
    failed: "처리 실패",
  };
  const uploadResultColor: Record<string, string> = {
    created: CFO.inflow,
    duplicate: CFO.brass,
    skipped_not_ours: CFO.muted,
    failed: CFO.outflow,
  };

  const PURCHASE_COLS: Col[] = [
    { key: "supplierName", label: "공급자" },
    { key: "issueId", label: "승인번호" },
    {
      key: "issueDate",
      label: "작성일",
      format: (v) => koDate(v as string),
    },
    {
      key: "supplyAmount",
      label: "공급가액",
      format: (v) => won(v as number),
    },
    { key: "vatAmount", label: "세액", format: (v) => won(v as number) },
    {
      key: "totalAmount",
      label: "합계",
      format: (v) => won(v as number),
    },
    {
      key: "status",
      label: "상태",
      format: (v) => <StatusBadge status={v as string} />,
    },
  ];

  return (
    <div className="space-y-5">
      <SectionRule title="매입 세금계산서" />

      <TaxTable rows={rows} cols={PURCHASE_COLS} loading={loading} />

      {/* HTML 업로드 */}
      <div
        className="rounded-xl border p-5 space-y-3"
        style={{ borderColor: CFO.hairline, background: "#fff" }}
      >
        <p
          className="text-[11px] font-medium uppercase tracking-wide"
          style={{ color: CFO.muted }}
        >
          세금계산서 메일(.html) 업로드
        </p>
        <p className="text-xs" style={{ color: CFO.muted }}>
          아웃룩 자동수집의 수동 대체 수단 — 메일 HTML을 붙여넣거나 파일로
          업로드하세요.
        </p>
        <textarea
          value={htmlInput}
          onChange={(e) => setHtmlInput(e.target.value)}
          placeholder="세금계산서 메일 HTML을 여기에 붙여넣으세요..."
          aria-label="세금계산서 메일 HTML"
          rows={5}
          className="w-full rounded-md px-3 py-2 text-xs font-mono"
          style={{ border: `1px solid ${CFO.hairline}`, background: CFO.paper, color: CFO.ink }}
        />
        <div className="flex flex-wrap items-center gap-3">
          <label
            className="cursor-pointer rounded-md px-3 py-1.5 text-xs font-medium transition-opacity hover:opacity-80"
            style={{ border: `1px solid ${CFO.hairline}`, background: "#fff", color: CFO.ink }}
          >
            파일 선택
            <input
              ref={fileRef}
              type="file"
              accept=".html,.htm"
              className="hidden"
              onChange={handleFileRead}
            />
          </label>
          <button
            onClick={handleUpload}
            disabled={uploading || !htmlInput.trim()}
            className="rounded-md px-4 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
            style={{ background: CFO.ink }}
          >
            {uploading ? "처리 중..." : "업로드"}
          </button>
          {uploadResult && (
            <span
              className="text-xs font-medium"
              style={{
                color:
                  uploadResultColor[uploadResult.status ?? "failed"] ??
                  CFO.muted,
              }}
            >
              {uploadResultLabel[uploadResult.status ?? "failed"] ??
                uploadResult.status}
              {uploadResult.taxInvoiceId
                ? ` (ID: ${uploadResult.taxInvoiceId})`
                : ""}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════
   SALES SECTION
══════════════════════════════════════════════════════ */
function SalesSection() {
  const [rows, setRows] = useState<TaxInvoice[]>([]);
  const [loading, setLoading] = useState(true);

  // Issue form state
  const [buyerCorpNum, setBuyerCorpNum] = useState("");
  const [buyerName, setBuyerName] = useState("");
  const [buyerCeoName, setBuyerCeoName] = useState("");
  const [lineItems, setLineItems] = useState<LineItem[]>([
    { name: "", amount: "" },
  ]);
  const [issuing, setIssuing] = useState(false);
  const [issueError, setIssueError] = useState<string | null>(null);
  const [issueSuccess, setIssueSuccess] = useState(false);

  const fetchSales = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/finance/tax-invoices?direction=sales");
      if (!res.ok) throw new Error("조회 실패");
      const json = await res.json();
      setRows(Array.isArray(json) ? json : []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchSales();
  }, [fetchSales]);

  const supplyTotal = lineItems.reduce(
    (acc, it) => acc + (parseFloat(it.amount) || 0),
    0,
  );
  const previewTotal = Math.round(supplyTotal * 1.1);

  const handleAddLine = () =>
    setLineItems((prev) => [...prev, { name: "", amount: "" }]);

  const handleLineChange = (
    idx: number,
    field: keyof LineItem,
    value: string,
  ) => {
    setLineItems((prev) =>
      prev.map((it, i) => (i === idx ? { ...it, [field]: value } : it)),
    );
  };

  const handleRemoveLine = (idx: number) =>
    setLineItems((prev) => prev.filter((_, i) => i !== idx));

  const handleIssue = async () => {
    setIssueError(null);
    setIssueSuccess(false);
    if (!buyerCorpNum.trim() || !buyerName.trim()) {
      setIssueError("사업자번호와 거래처명은 필수입니다.");
      return;
    }
    const validItems = lineItems.filter(
      (it) => it.name.trim() && parseFloat(it.amount) > 0,
    );
    if (validItems.length === 0) {
      setIssueError("품목을 1개 이상 입력해 주세요.");
      return;
    }
    setIssuing(true);
    try {
      const body: {
        buyerCorpNum: string;
        buyerName: string;
        buyerCeoName?: string;
        items: { name: string; amount: number }[];
      } = {
        buyerCorpNum: buyerCorpNum.trim(),
        buyerName: buyerName.trim(),
        items: validItems.map((it) => ({
          name: it.name.trim(),
          amount: Math.round(parseFloat(it.amount)),
        })),
      };
      if (buyerCeoName.trim()) body.buyerCeoName = buyerCeoName.trim();

      const res = await fetch("/api/finance/tax-invoices/issue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(
          (err as { message?: string }).message ?? "발행 실패",
        );
      }
      setIssueSuccess(true);
      setBuyerCorpNum("");
      setBuyerName("");
      setBuyerCeoName("");
      setLineItems([{ name: "", amount: "" }]);
      void fetchSales();
    } catch (e: unknown) {
      setIssueError(e instanceof Error ? e.message : "발행 실패");
    } finally {
      setIssuing(false);
    }
  };

  const handleMarkTransmitted = async (id: string) => {
    try {
      await fetch(`/api/finance/tax-invoices/${id}/transmitted`, {
        method: "POST",
      });
      void fetchSales();
    } catch {
      alert("전송완료 표시 실패");
    }
  };

  const SALES_COLS: Col[] = [
    { key: "buyerName", label: "거래처" },
    { key: "issueId", label: "승인번호" },
    {
      key: "issueDate",
      label: "작성일",
      format: (v) => koDate(v as string),
    },
    {
      key: "supplyAmount",
      label: "공급가액",
      format: (v) => won(v as number),
    },
    { key: "vatAmount", label: "세액", format: (v) => won(v as number) },
    {
      key: "totalAmount",
      label: "합계",
      format: (v) => won(v as number),
    },
    {
      key: "status",
      label: "상태",
      format: (v) => <StatusBadge status={v as string} />,
    },
  ];

  const inputCls =
    "w-full rounded-md px-3 py-2 text-sm tabular-nums";
  const inputStyle = {
    border: `1px solid ${CFO.hairline}`,
    background: "#fff",
    color: CFO.ink,
  };
  const labelCls =
    "mb-1 block text-[11px] font-medium uppercase tracking-wide";

  return (
    <div className="space-y-5">
      <SectionRule title="매출 세금계산서 발행" />

      {/* Issue form */}
      <div
        className="rounded-xl border p-5 space-y-4"
        style={{ borderColor: CFO.hairline, background: "#fff" }}
      >
        <p
          className="text-[11px] font-medium uppercase tracking-wide"
          style={{ color: CFO.muted }}
        >
          신규 발행
        </p>

        {/* Buyer info */}
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label htmlFor="tax-buyer-corp-num" className={labelCls} style={{ color: CFO.muted }}>
              거래처 사업자번호 *
            </label>
            <input
              id="tax-buyer-corp-num"
              type="text"
              value={buyerCorpNum}
              onChange={(e) => setBuyerCorpNum(e.target.value)}
              placeholder="000-00-00000"
              className={inputCls}
              style={inputStyle}
            />
          </div>
          <div>
            <label htmlFor="tax-buyer-name" className={labelCls} style={{ color: CFO.muted }}>
              거래처명 *
            </label>
            <input
              id="tax-buyer-name"
              type="text"
              value={buyerName}
              onChange={(e) => setBuyerName(e.target.value)}
              placeholder="(주)홍길동"
              className={inputCls}
              style={inputStyle}
            />
          </div>
          <div>
            <label htmlFor="tax-buyer-ceo-name" className={labelCls} style={{ color: CFO.muted }}>
              대표자 (선택)
            </label>
            <input
              id="tax-buyer-ceo-name"
              type="text"
              value={buyerCeoName}
              onChange={(e) => setBuyerCeoName(e.target.value)}
              placeholder="홍길동"
              className={inputCls}
              style={inputStyle}
            />
          </div>
        </div>

        {/* Line items */}
        <div className="space-y-2">
          <p className={labelCls} style={{ color: CFO.muted }}>
            품목
          </p>
          {lineItems.map((it, idx) => (
            <div key={idx} className="flex gap-2">
              <input
                type="text"
                value={it.name}
                onChange={(e) =>
                  handleLineChange(idx, "name", e.target.value)
                }
                placeholder="품목명"
                aria-label={`품목명 ${idx + 1}`}
                className="flex-1 rounded-md px-3 py-2 text-sm"
                style={inputStyle}
              />
              <input
                type="number"
                value={it.amount}
                onChange={(e) =>
                  handleLineChange(idx, "amount", e.target.value)
                }
                placeholder="공급가액"
                aria-label={`공급가액 ${idx + 1}`}
                step={1000}
                className="w-40 rounded-md px-3 py-2 text-sm tabular-nums"
                style={inputStyle}
              />
              {lineItems.length > 1 && (
                <button
                  onClick={() => handleRemoveLine(idx)}
                  className="px-2 text-sm hover:opacity-70"
                  style={{ color: CFO.outflow }}
                >
                  ✕
                </button>
              )}
            </div>
          ))}
          <button
            onClick={handleAddLine}
            className="text-xs hover:underline"
            style={{ color: CFO.brass }}
          >
            + 품목 추가
          </button>
        </div>

        {/* Preview total */}
        <div
          className="rounded-lg px-4 py-3 text-sm"
          style={{ background: CFO.paper, border: `1px solid ${CFO.hairline}` }}
        >
          <span style={{ color: CFO.muted }}>공급가액 합계 </span>
          <span className="font-semibold tabular-nums" style={{ color: CFO.ink }}>
            {won(supplyTotal)}
          </span>
          <span style={{ color: CFO.muted }}> · VAT(10%) 포함 예상 합계 </span>
          <span className="font-semibold tabular-nums" style={{ color: CFO.inflow }}>
            {won(previewTotal)}
          </span>
          <span
            className="ml-2 text-xs"
            style={{ color: CFO.muted }}
          >
            (VAT는 서버에서 자동 계산)
          </span>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3">
          <button
            onClick={handleIssue}
            disabled={issuing}
            className="rounded-md px-5 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            style={{ background: CFO.ink }}
          >
            {issuing ? "발행 중..." : "세금계산서 발행"}
          </button>
          {issueSuccess && (
            <span className="text-sm font-medium" style={{ color: CFO.inflow }}>
              ✓ 발행 완료
            </span>
          )}
          {issueError && (
            <span className="text-sm" style={{ color: CFO.outflow }}>
              {issueError}
            </span>
          )}
        </div>
      </div>

      {/* Sales table */}
      <SectionRule title="매출 내역" />
      <p className="text-xs" style={{ color: CFO.muted }}>
        국세청 전송은 홈택스에서 수동 발급 후 아래 &quot;전송완료 표시&quot; 버튼으로 상태를 갱신하세요.
      </p>
      <TaxTable
        rows={rows}
        cols={SALES_COLS}
        loading={loading}
        extra={(row) =>
          row.status !== "transmitted" ? (
            <button
              onClick={() => handleMarkTransmitted(row.id)}
              className="whitespace-nowrap rounded-md px-3 py-1 text-xs font-medium transition-opacity hover:opacity-80"
              style={{
                border: `1px solid ${CFO.hairline}`,
                background: "#fff",
                color: CFO.ink,
              }}
            >
              전송완료 표시
            </button>
          ) : (
            <span className="text-xs" style={{ color: CFO.muted }}>
              —
            </span>
          )
        }
      />
    </div>
  );
}

/* ══════════════════════════════════════════════════════
   PAGE
══════════════════════════════════════════════════════ */
export default function TaxInvoicesPage() {
  const [tab, setTab] = useState<"purchase" | "sales">("purchase");

  return (
    <div className="space-y-6" style={{ color: CFO.ink }}>
      <CfoPageHeading title="세금계산서" />

      {/* Tab strip */}
      <div
        className="flex gap-1 rounded-lg p-1"
        style={{ background: CFO.paper, border: `1px solid ${CFO.hairline}`, width: "fit-content" }}
      >
        {(["purchase", "sales"] as const).map((t) => {
          const active = tab === t;
          return (
            <button
              key={t}
              onClick={() => setTab(t)}
              className="rounded-md px-4 py-1.5 text-sm font-medium transition-colors"
              style={{
                background: active ? CFO.ink : "transparent",
                color: active ? "#fff" : CFO.muted,
              }}
            >
              {t === "purchase" ? "매입" : "매출"}
            </button>
          );
        })}
      </div>

      {tab === "purchase" ? <PurchaseSection /> : <SalesSection />}
    </div>
  );
}

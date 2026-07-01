"use client";

import { useEffect, useState } from "react";
import CrudTable from "@/components/cfo/crud-table";
import { BankCsvImport } from "@/components/cfo/bank-csv-import";
import { won } from "@/lib/format-krw";

const CASHFLOW_FIELDS = [
  { name: "counterparty", label: "거래처", type: "text" as const, required: true },
  { name: "amount", label: "금액", type: "number" as const, required: true, step: 1000 },
  {
    name: "type",
    label: "유형",
    type: "select" as const,
    options: [
      { value: "매출입금", label: "매출입금" },
      { value: "매입지급", label: "매입지급" },
      { value: "비용지급", label: "비용지급" },
      { value: "급여지급", label: "급여지급" },
      { value: "세금", label: "세금" },
      { value: "이체", label: "이체" },
      { value: "기타", label: "기타" },
    ],
  },
  { name: "date", label: "일자", type: "date" as const },
  {
    name: "outAccount",
    label: "출금계좌",
    type: "select" as const,
    options: [
      { value: "법인통장", label: "법인통장" },
      { value: "법인카드", label: "법인카드" },
      { value: "개인카드", label: "개인카드" },
      { value: "기타", label: "기타" },
    ],
  },
  {
    name: "inAccount",
    label: "입금계좌",
    type: "select" as const,
    options: [
      { value: "법인통장", label: "법인통장" },
      { value: "기타", label: "기타" },
    ],
  },
  { name: "memo", label: "메모", type: "text" as const },
];

// Columns mirror the Notion "자금흐름 DB" view:
// 프로젝트, 거래처, 유형, 일자, 금액, 현금변동, 입금계좌, 출금계좌, 메모
const CASHFLOW_COLUMNS = [
  { key: "project", label: "프로젝트", format: (_: unknown, row: { project?: { name?: string } }) => row.project?.name ?? "-" },
  { key: "counterparty", label: "거래처", format: (v: string) => v || "-" },
  {
    key: "type",
    label: "유형",
    format: (v: string) => (
      <span
        className={`rounded px-2 py-0.5 text-xs font-medium ${
          v === "매출입금"
            ? "bg-green-100 text-green-700"
            : v === "매입지급" || v === "비용지급"
            ? "bg-red-100 text-red-700"
            : "bg-blue-100 text-blue-700"
        }`}
      >
        {v}
      </span>
    ),
  },
  {
    key: "date",
    label: "일자",
    format: (v: string) => (v ? new Date(v).toLocaleDateString("ko-KR") : "-"),
  },
  { key: "amount", label: "금액", format: won },
  {
    key: "cashChange",
    label: "현금변동",
    format: (v: number) => <span className={(v ?? 0) < 0 ? "text-red-600" : "text-green-600"}>{won(v)}</span>,
  },
  { key: "inAccount", label: "입금계좌", format: (v: string) => v || "-" },
  { key: "outAccount", label: "출금계좌", format: (v: string) => v || "-" },
  { key: "memo", label: "메모", format: (v: string) => v || "-" },
];

export default function CashflowsPage() {
  const [projectOptions, setProjectOptions] = useState<{ value: string; label: string }[]>([]);
  const [rematching, setRematching] = useState(false);
  const [rematchMsg, setRematchMsg] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/finance/projects?limit=500")
      .then((r) => r.json())
      .then((rows: { id: string; name: string }[]) =>
        setProjectOptions([{ value: "", label: "(미지정)" }, ...rows.map((p) => ({ value: p.id, label: p.name }))]),
      )
      .catch(() => setProjectOptions([{ value: "", label: "(미지정)" }]));
  }, []);

  const rematch = async () => {
    setRematching(true);
    setRematchMsg(null);
    try {
      const res = await fetch("/api/finance/cashflows/rematch", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "실패");
      setRematchMsg(`✅ ${data.matched}건 프로젝트 자동 연결 (${data.scanned}건 검사)`);
      setTimeout(() => window.location.reload(), 1200);
    } catch (e) {
      setRematchMsg(`❌ ${e instanceof Error ? e.message : "오류"}`);
    } finally {
      setRematching(false);
    }
  };

  // Project select is appended so rows can be (re)assigned manually.
  const fields = [
    ...CASHFLOW_FIELDS,
    { name: "projectId", label: "프로젝트", type: "select" as const, options: projectOptions },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">자금흐름</h1>
        <button
          onClick={rematch}
          disabled={rematching}
          className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
        >
          {rematching ? "매칭 중…" : "프로젝트 자동 재매칭"}
        </button>
      </div>
      {rematchMsg && <p className="text-sm">{rematchMsg}</p>}
      <BankCsvImport />
      <CrudTable
        title=""
        endpoint="cashflows"
        fields={fields}
        columns={CASHFLOW_COLUMNS}
      />
    </div>
  );
}

"use client";

import CrudTable from "@/components/cfo/crud-table";

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

const CASHFLOW_COLUMNS = [
  { key: "counterparty", label: "거래처" },
  { key: "amount", label: "금액", format: (v: number) => `₩${(v ?? 0).toLocaleString()}` },
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
  { key: "outAccount", label: "출금계좌" },
  { key: "inAccount", label: "입금계좌" },
  { key: "memo", label: "메모" },
];

export default function CashflowsPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">자금흐름</h1>
      <CrudTable
        title=""
        endpoint="cashflows"
        fields={CASHFLOW_FIELDS}
        columns={CASHFLOW_COLUMNS}
      />
    </div>
  );
}

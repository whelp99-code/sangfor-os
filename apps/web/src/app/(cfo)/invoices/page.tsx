"use client";

import CrudTable from "@/components/cfo/crud-table";

const INVOICE_FIELDS = [
  { name: "buyer", label: "거래처", type: "text" as const, required: true },
  { name: "amount", label: "금액", type: "number" as const, required: true, step: 1000 },
  { name: "depositAmount", label: "입금액", type: "number" as const, step: 1000 },
  {
    name: "depositStatus",
    label: "입금상태",
    type: "select" as const,
    options: [
      { value: "미수", label: "미수" },
      { value: "부분", label: "부분입금" },
      { value: "완료", label: "입금완료" },
    ],
  },
  { name: "depositDate", label: "입금일", type: "date" as const },
  { name: "memo", label: "메모", type: "text" as const },
];

const INVOICE_COLUMNS = [
  { key: "buyer", label: "거래처" },
  { key: "amount", label: "금액", format: (v: number) => `₩${(v ?? 0).toLocaleString()}` },
  { key: "depositAmount", label: "입금액", format: (v: number) => `₩${(v ?? 0).toLocaleString()}` },
  {
    key: "depositStatus",
    label: "입금상태",
    format: (v: string) => (
      <span
        className={`rounded px-2 py-0.5 text-xs font-medium ${
          v === "완료"
            ? "bg-green-100 text-green-700"
            : v === "부분"
            ? "bg-yellow-100 text-yellow-700"
            : "bg-red-100 text-red-700"
        }`}
      >
        {v}
      </span>
    ),
  },
  {
    key: "depositDate",
    label: "입금일",
    format: (v: string) => (v ? new Date(v).toLocaleDateString("ko-KR") : "-"),
  },
];

export default function InvoicesPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">미수금 / 인보이스</h1>
      <CrudTable
        title=""
        endpoint="invoices"
        fields={INVOICE_FIELDS}
        columns={INVOICE_COLUMNS}
      />
    </div>
  );
}

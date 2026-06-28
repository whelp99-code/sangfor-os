"use client";

import CrudTable from "@/components/cfo/crud-table";

const EXPENSE_FIELDS = [
  { name: "expenseName", label: "지출명", type: "text" as const, required: true },
  {
    name: "category",
    label: "구분",
    type: "select" as const,
    options: [
      { value: "원가(매입)", label: "원가(매입)" },
      { value: "판관비", label: "판관비" },
      { value: "급여", label: "급여" },
      { value: "세무 보험", label: "세무 보험" },
      { value: "기타", label: "기타" },
    ],
  },
  { name: "vendor", label: "매입처", type: "text" as const },
  { name: "date", label: "일자", type: "date" as const },
  { name: "amount", label: "공급가액", type: "number" as const, step: 1000 },
  { name: "vat", label: "VAT", type: "number" as const, step: 100 },
  {
    name: "paymentMethod",
    label: "결제수단",
    type: "select" as const,
    options: [
      { value: "법인통장", label: "법인통장" },
      { value: "법인카드", label: "법인카드" },
      { value: "개인카드(정산)", label: "개인카드(정산)" },
      { value: "현금", label: "현금" },
    ],
  },
  {
    name: "proofType",
    label: "증빙",
    type: "select" as const,
    options: [
      { value: "전자세금계산서", label: "전자세금계산서" },
      { value: "카드전표", label: "카드전표" },
      { value: "현금영수증", label: "현금영수증" },
      { value: "간이영수증", label: "간이영수증" },
      { value: "", label: "없음" },
    ],
  },
  { name: "isPaid", label: "납입완료", type: "checkbox" as const },
];

const EXPENSE_COLUMNS = [
  { key: "expenseName", label: "지출명" },
  { key: "vendor", label: "매입처" },
  { key: "category", label: "구분" },
  { key: "date", label: "일자", format: (v: string) => (v ? new Date(v).toLocaleDateString("ko-KR") : "-") },
  { key: "amount", label: "공급가액", format: (v: number) => `₩${(v ?? 0).toLocaleString()}` },
  { key: "vat", label: "VAT", format: (v: number) => `₩${(v ?? 0).toLocaleString()}` },
  { key: "total", label: "합계", format: (v: number) => `₩${(v ?? 0).toLocaleString()}` },
  { key: "isPaid", label: "납입", format: (v: boolean) => (v ? "✅" : "⬜") },
];

export default function ExpensesPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">매입 / 비용</h1>
      <CrudTable
        title=""
        endpoint="expenses"
        fields={EXPENSE_FIELDS}
        columns={EXPENSE_COLUMNS}
      />
    </div>
  );
}

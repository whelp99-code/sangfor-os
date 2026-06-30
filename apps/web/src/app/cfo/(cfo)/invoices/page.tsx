"use client";

import CrudTable from "@/components/cfo/crud-table";
import { useProjectOptions } from "@/components/cfo/use-project-options";
import { CfoPageHeading } from "@/components/cfo/page-heading";
import { CFO } from "@/lib/cfo-theme";

const INVOICE_FIELDS = [
  { name: "issueDate", label: "발행일", type: "date" as const },
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

const won = (v: number) => `₩${(v ?? 0).toLocaleString()}`;

// Columns mirror the Notion "미수금/입금관리" view:
// 프로젝트, 거래처, 공급가액, VAT, 합계, 입금상태, 입금일, 입금액, 메모
const INVOICE_COLUMNS = [
  { key: "project", label: "프로젝트", format: (_: unknown, row: { project?: { name?: string } }) => row.project?.name ?? "-" },
  { key: "issueDate", label: "일자", format: (v: string) => (v ? new Date(v).toLocaleDateString("ko-KR") : "-") },
  { key: "buyer", label: "거래처" },
  { key: "amount", label: "공급가액", format: won },
  { key: "vat", label: "VAT", format: won },
  { key: "total", label: "합계", format: won },
  {
    key: "depositStatus",
    label: "입금상태",
    format: (v: string) => {
      const tone = v === "완료" ? CFO.inflow : v === "부분" ? CFO.brass : CFO.outflow;
      return (
        <span
          className="inline-block whitespace-nowrap rounded px-2 py-0.5 text-xs font-medium"
          style={{ color: tone, background: `${tone}1A` }}
        >
          {v}
        </span>
      );
    },
  },
  {
    key: "depositDate",
    label: "입금일",
    format: (v: string) => (v ? new Date(v).toLocaleDateString("ko-KR") : "-"),
  },
  { key: "depositAmount", label: "입금액", format: won },
  { key: "memo", label: "메모", format: (v: string) => v || "-" },
];

export default function InvoicesPage() {
  const projectOptions = useProjectOptions();
  const fields = [
    ...INVOICE_FIELDS,
    { name: "projectId", label: "프로젝트", type: "select" as const, options: projectOptions },
  ];
  return (
    <div className="space-y-4">
      <CfoPageHeading title="미수금 / 인보이스" />
      <CrudTable
        title=""
        endpoint="invoices"
        fields={fields}
        columns={INVOICE_COLUMNS}
        filters={[
          {
            key: "depositStatus",
            label: "입금상태",
            options: [
              { value: "all", label: "전체", test: () => true },
              { value: "미수", label: "미수", test: (row) => (row.depositStatus ?? "미수") === "미수" },
              { value: "부분", label: "부분입금", test: (row) => row.depositStatus === "부분" },
              { value: "완료", label: "입금완료", test: (row) => row.depositStatus === "완료" },
            ],
          },
        ]}
      />
    </div>
  );
}

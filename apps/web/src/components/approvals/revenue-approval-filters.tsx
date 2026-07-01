import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";

type FilterKey = "ownerRole" | "itemType" | "status";

export type RevenueApprovalFilterValues = {
  ownerRole: "all" | "sales" | "presales" | "cfo";
  itemType: "all" | "quote" | "proposal" | "discount";
  status: "all" | "draft" | "ready_for_human_approval" | "approved" | "rejected";
};

type FilterOption = {
  label: string;
  value: RevenueApprovalFilterValues[FilterKey];
};

const FILTER_OPTIONS: Record<FilterKey, FilterOption[]> = {
  ownerRole: [
    { label: "전체 역할", value: "all" },
    { label: "영업", value: "sales" },
    { label: "프리세일즈", value: "presales" },
    { label: "CFO", value: "cfo" },
  ],
  itemType: [
    { label: "전체 유형", value: "all" },
    { label: "견적", value: "quote" },
    { label: "제안", value: "proposal" },
    { label: "할인", value: "discount" },
  ],
  status: [
    { label: "전체 상태", value: "all" },
    { label: "초안", value: "draft" },
    { label: "승인 대기", value: "ready_for_human_approval" },
    { label: "승인됨", value: "approved" },
    { label: "반려됨", value: "rejected" },
  ],
};

const FILTER_LABELS: Record<FilterKey, string> = {
  ownerRole: "담당자 역할",
  itemType: "항목 유형",
  status: "상태",
};

export function RevenueApprovalFilters({
  filters,
  filteredCount,
  totalCount,
}: {
  filters: RevenueApprovalFilterValues;
  filteredCount: number;
  totalCount: number;
}) {
  return (
    <div className="space-y-4 rounded-lg border bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-medium">매출 승인 필터</h3>
          <p className="text-sm text-muted-foreground">
            담당자, 유형, 승인 상태로 매출 승인 항목을 좁혀 조회합니다.
          </p>
        </div>
        <Badge variant="outline">
          전체 {totalCount}건 중 {filteredCount}건 표시
        </Badge>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {(Object.keys(FILTER_OPTIONS) as FilterKey[]).map((key) => (
          <div key={key} className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {FILTER_LABELS[key]}
            </p>
            <div className="flex flex-wrap gap-2">
              {FILTER_OPTIONS[key].map((option) => {
                const active = filters[key] === option.value;
                return (
                  <Link
                    key={option.value}
                    href={{
                      pathname: "/approvals",
                      query: nextFilterQuery(filters, key, option.value),
                    }}
                    className={buttonVariants({ variant: active ? "default" : "outline", size: "sm" })}
                    aria-current={active ? "page" : undefined}
                  >
                    {option.label}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function nextFilterQuery(
  filters: RevenueApprovalFilterValues,
  key: FilterKey,
  value: RevenueApprovalFilterValues[FilterKey],
) {
  const nextFilters = { ...filters, [key]: value };
  return Object.fromEntries(
    Object.entries(nextFilters).filter(([, filterValue]) => filterValue !== "all"),
  );
}

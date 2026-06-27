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
    { label: "All roles", value: "all" },
    { label: "Sales", value: "sales" },
    { label: "Presales", value: "presales" },
    { label: "CFO", value: "cfo" },
  ],
  itemType: [
    { label: "All types", value: "all" },
    { label: "Quotes", value: "quote" },
    { label: "Proposals", value: "proposal" },
    { label: "Discounts", value: "discount" },
  ],
  status: [
    { label: "All statuses", value: "all" },
    { label: "Draft", value: "draft" },
    { label: "Ready for approval", value: "ready_for_human_approval" },
    { label: "Approved", value: "approved" },
    { label: "Rejected", value: "rejected" },
  ],
};

const FILTER_LABELS: Record<FilterKey, string> = {
  ownerRole: "Owner role",
  itemType: "Item type",
  status: "Status",
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
          <h3 className="font-medium">Revenue approval filters</h3>
          <p className="text-sm text-muted-foreground">
            Narrow commercial approval metadata by owner, type, and approval status.
          </p>
        </div>
        <Badge variant="outline">
          {filteredCount} of {totalCount} shown
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

"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ComponentProps, ReactNode } from "react";

import { Tabs } from "@/components/ui/tabs";

/**
 * Deal detail tab keys — shared by the server page (validates the initial
 * `?tab=`) and this client wrapper (keeps it in sync afterwards), so the
 * two lists can never drift apart.
 */
export const DEAL_DETAIL_TABS = ["작업", "상세", "문서", "연락처", "채널·등록", "활동"] as const;
export type DealDetailTab = (typeof DEAL_DETAIL_TABS)[number];

type DealDetailTabsProps = {
  /** Server-validated fallback, used when `?tab=` is missing or invalid. */
  defaultTab: DealDetailTab;
  className?: string;
  children: ReactNode;
};

/**
 * Tabs controlled by `?tab=` so hard loads, in-app links, and browser
 * back/forward all agree on which panel is showing.
 */
export function DealDetailTabs({ defaultTab, className, children }: DealDetailTabsProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const tabParam = searchParams.get("tab");
  const activeTab: DealDetailTab =
    tabParam && (DEAL_DETAIL_TABS as readonly string[]).includes(tabParam)
      ? (tabParam as DealDetailTab)
      : defaultTab;

  const handleValueChange: NonNullable<ComponentProps<typeof Tabs>["onValueChange"]> = (value) => {
    if (typeof value !== "string" || value === activeTab) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", value);
    // replace (not push): switching tabs shouldn't stack up browser history.
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  return (
    <Tabs value={activeTab} onValueChange={handleValueChange} className={className}>
      {children}
    </Tabs>
  );
}

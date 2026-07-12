"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState, type ComponentProps, type ReactNode } from "react";

import { Tabs } from "@/components/ui/tabs";
import { DEAL_DETAIL_TABS, type DealDetailTab } from "./deal-detail-tabs.constants";

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
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const tabParam = searchParams.get("tab");
  const urlTab: DealDetailTab =
    tabParam && (DEAL_DETAIL_TABS as readonly string[]).includes(tabParam)
      ? (tabParam as DealDetailTab)
      : defaultTab;
  const [activeTab, setActiveTab] = useState<DealDetailTab>(urlTab);

  // Follow the URL when it changes outside this control (deep link, back/forward).
  useEffect(() => {
    setActiveTab(urlTab);
  }, [urlTab]);

  const handleValueChange: NonNullable<ComponentProps<typeof Tabs>["onValueChange"]> = (value) => {
    if (typeof value !== "string" || value === activeTab) return;
    // Switch the panel immediately; the URL sync below is a heavy Server
    // Component round-trip and must not gate the visual response.
    setActiveTab(value as DealDetailTab);
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", value);
    // Sync the URL for deep-link/refresh without the router's Server Component
    // refetch — that round-trip is what dropped ~half the tab clicks (R3B-3).
    window.history.replaceState(null, "", `${pathname}?${params.toString()}`);
  };

  return (
    <Tabs value={activeTab} onValueChange={handleValueChange} className={className}>
      {children}
    </Tabs>
  );
}

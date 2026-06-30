"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  BarChart3,
  Blocks,
  BookOpen,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Code2,
  DollarSign,
  FileText,
  FlaskConical,
  FolderKanban,
  Handshake,
  Home,
  Contact,
  Building2,
  Headphones,
  Inbox,
  LayoutDashboard,
  ListChecks,
  Mail,
  Palette,
  Search,
  Settings,
  Shield,
  ShieldCheck,
  Sparkles,
  Terminal,
  TrendingUp,
  Truck,
  Users,
  Wrench,
} from "lucide-react";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarInset,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PROJECT_NAME } from "@sangfor/shared";

import { AppTopbar } from "@/components/shell/app-topbar";
import { getVisibleNavItems } from "@/lib/permissions";
import type { NavItem } from "@/lib/portal-config";


const ICONS = {
  activity: BarChart3,
  blocks: Blocks,
  "book-open": BookOpen,
  bot: Bot,
  wrench: Wrench,
  search: Search,
  code: Code2,
  sparkles: Sparkles,
  "check-circle": CheckCircle2,
  "shield-check": ShieldCheck,
  palette: Palette,
  "bar-chart": BarChart3,
  "layout-dashboard": LayoutDashboard,
  flask: FlaskConical,
  "dollar-sign": DollarSign,
  "file-text": FileText,
  "folder-kanban": FolderKanban,
  handshake: Handshake,
  truck: Truck,
  headphones: Headphones,
  inbox: Inbox,
  "list-checks": ListChecks,
  mail: Mail,
  shield: Shield,
  terminal: Terminal,
  "trending-up": TrendingUp,
  users: Users,
  settings: Settings,
  home: Home,
  contact: Contact,
  building: Building2,
} as const;

const GROUP_ORDER = ["홈", "CRM", "프로젝트", "재무", "지식", "시스템"];

const NAV_BADGES: Record<string, number> = {
  "/approvals": 3,
  "/development/mail-candidates": 7,
};

/**
 * Badge tone by pending count (docs/UX-AX-STANDARDS.md §2.3):
 * 1–3 = info (blue), 4–9 = caution (orange), 10+ = warning (red).
 * A count of 0 hides the badge entirely (handled at the call site).
 */
function badgeToneClass(count: number): string {
  if (count >= 10) return "bg-destructive text-white";
  if (count >= 4) return "bg-status-stale text-white";
  return "bg-primary text-primary-foreground";
}

function NavMenuButton({
  item,
  pathname,
}: {
  item: { title: string; href: string; icon: string };
  pathname: string;
}) {
  const Icon = ICONS[item.icon as keyof typeof ICONS] ?? LayoutDashboard;
  const badge = NAV_BADGES[item.href];
  const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={isActive}
        tooltip={item.title}
        render={<Link href={item.href} />}
      >
        <Icon aria-hidden="true" />
        <span>{item.title}</span>
        {badge ? (
          <span
            className={cn(
              "ml-auto flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-semibold tabular-nums",
              badgeToneClass(badge)
            )}
            aria-label={`처리 필요 ${badge}건`}
          >
            {badge}
          </span>
        ) : null}
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

export function PortalShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const navItems = getVisibleNavItems();
  const [query, setQuery] = useState("");
  const [moreOpen, setMoreOpen] = useState(false);

  const normalized = query.trim().toLowerCase();
  const filtered = normalized
    ? navItems.filter((item) => item.title.toLowerCase().includes(normalized))
    : navItems;

  // When searching, ignore tier split and show all matching items grouped.
  // When not searching, split by tier: primary items always visible, rest under 더보기.
  const isSearching = normalized.length > 0;

  const primaryItems = isSearching ? [] : filtered.filter((i) => i.tier === "primary");
  const moreItems = isSearching ? [] : filtered.filter((i) => i.tier !== "primary");

  // For search results and the 더보기 expanded view, group by `group`
  const buildGroups = (items: NavItem[]) =>
    items.reduce<Record<string, NavItem[]>>((acc, item) => {
      const groupName = item.group ?? "시스템";
      acc[groupName] ??= [];
      acc[groupName].push(item);
      return acc;
    }, {});

  const searchGroups = isSearching ? buildGroups(filtered) : {};
  const searchVisibleGroups = GROUP_ORDER.filter((g) => searchGroups[g]?.length);

  const moreGroups = buildGroups(moreItems);
  const moreVisibleGroups = GROUP_ORDER.filter((g) => moreGroups[g]?.length);

  const handleAiCommand = () => {
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true })
    );
  };

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader className="gap-2 border-b border-sidebar-border px-3 py-3">
          <div className="px-1 group-data-[collapsible=icon]:hidden">
            <p className="text-xs font-medium text-muted-foreground">{PROJECT_NAME}</p>
            <p className="text-sm font-semibold">SANGFOR Partner OS</p>
            <Badge variant="secondary" className="mt-1 w-fit text-[10px] font-medium">
              통합 CRM · 프로젝트
            </Badge>
          </div>
          <div className="relative group-data-[collapsible=icon]:hidden">
            <Search
              className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <SidebarInput
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="메뉴 검색…"
              aria-label="메뉴 검색"
              className="pl-7"
            />
          </div>
        </SidebarHeader>
        <SidebarContent className="scrollbar-thin">
          {/* ── Search mode: show all matching items across all tiers ── */}
          {isSearching && (
            <>
              {searchVisibleGroups.length === 0 ? (
                <p className="px-4 py-6 text-center text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
                  "{query}"에 해당하는 메뉴가 없습니다.
                </p>
              ) : (
                searchVisibleGroups.map((groupName) => (
                  <SidebarGroup key={groupName}>
                    <SidebarGroupLabel>{groupName}</SidebarGroupLabel>
                    <SidebarGroupContent>
                      <SidebarMenu>
                        {searchGroups[groupName].map((item) => (
                          <NavMenuButton key={item.href} item={item} pathname={pathname} />
                        ))}
                      </SidebarMenu>
                    </SidebarGroupContent>
                  </SidebarGroup>
                ))
              )}
            </>
          )}

          {/* ── Normal mode: primary items always visible ── */}
          {!isSearching && (
            <>
              <SidebarGroup>
                <SidebarGroupLabel>핵심</SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {primaryItems.map((item) => (
                      <NavMenuButton key={item.href} item={item} pathname={pathname} />
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>

              {/* ── 더보기 collapsible section ── */}
              {moreItems.length > 0 && (
                <SidebarGroup>
                  <button
                    type="button"
                    aria-expanded={moreOpen}
                    onClick={() => setMoreOpen((prev) => !prev)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs font-medium",
                      "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                      "transition-colors group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
                    )}
                  >
                    {moreOpen ? (
                      <ChevronDown className="size-3.5 shrink-0" aria-hidden="true" />
                    ) : (
                      <ChevronRight className="size-3.5 shrink-0" aria-hidden="true" />
                    )}
                    <span className="group-data-[collapsible=icon]:hidden">
                      더보기 ({moreItems.length})
                    </span>
                  </button>

                  {moreOpen && (
                    <>
                      <p className="mt-1 mb-1 px-2 text-[10px] text-muted-foreground group-data-[collapsible=icon]:hidden">
                        재무·지식·AI·시스템 — 정렬 후순위
                      </p>
                      {moreVisibleGroups.map((groupName) => (
                        <SidebarGroup key={groupName} className="pt-0">
                          <SidebarGroupLabel>{groupName}</SidebarGroupLabel>
                          <SidebarGroupContent>
                            <SidebarMenu>
                              {moreGroups[groupName].map((item) => (
                                <NavMenuButton key={item.href} item={item} pathname={pathname} />
                              ))}
                            </SidebarMenu>
                          </SidebarGroupContent>
                        </SidebarGroup>
                      ))}
                    </>
                  )}
                </SidebarGroup>
              )}
            </>
          )}
        </SidebarContent>
        <SidebarFooter className="border-t border-sidebar-border p-3">
          <Button
            variant="outline"
            className="w-full justify-start gap-2 text-xs"
            onClick={handleAiCommand}
          >
            <Sparkles className="h-3.5 w-3.5" />
            <span className="group-data-[collapsible=icon]:hidden">AI 어시스턴트</span>
            <kbd className="ml-auto inline-flex h-5 items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground group-data-[collapsible=icon]:hidden">
              <span className="text-xs">⌘</span>K
            </kbd>
          </Button>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset>
        <AppTopbar />
        <div className="flex flex-1 flex-col gap-6 p-6">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}

export function PortalShellTrigger() {
  return <SidebarTrigger className="-ml-1" />;
}

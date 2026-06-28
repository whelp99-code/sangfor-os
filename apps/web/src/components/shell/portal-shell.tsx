"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Blocks,
  BookOpen,
  Bot,
  CheckCircle2,
  Code2,
  DollarSign,
  FileText,
  FlaskConical,
  Handshake,
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
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarInset,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
} as const;

const GROUP_ORDER = ["Business", "Finance", "Intelligence", "Development", "System"];

const NAV_BADGES: Record<string, number> = {
  "/approvals": 3,
  "/development/mail-candidates": 7,
};

export function PortalShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const navItems = getVisibleNavItems();

  const groups = navItems.reduce<Record<string, NavItem[]>>((acc, item) => {
    const groupName = item.group ?? "System";
    acc[groupName] ??= [];
    acc[groupName].push(item);
    return acc;
  }, {});

  const handleAiCommand = () => {
    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "k",
        metaKey: true,
        bubbles: true,
      })
    );
  };

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader className="border-b border-sidebar-border px-4 py-3">
          <p className="text-xs font-medium text-muted-foreground">{PROJECT_NAME}</p>
          <p className="text-sm font-semibold">SANGFOR Partner OS</p>
          <Badge variant="secondary" className="mt-1 w-fit text-[10px] font-medium">
            통합 운영 포털
          </Badge>
        </SidebarHeader>
        <SidebarContent>
          {GROUP_ORDER.filter((groupName) => groups[groupName]?.length).map((groupName) => (
            <SidebarGroup key={groupName}>
              <SidebarGroupLabel>{groupName}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {groups[groupName].map((item) => {
                    const Icon = ICONS[item.icon as keyof typeof ICONS] ?? LayoutDashboard;
                    const badge = NAV_BADGES[item.href];
                    return (
                      <SidebarMenuItem key={item.href}>
                        <SidebarMenuButton
                          isActive={pathname.startsWith(item.href)}
                          render={<Link href={item.href} />}
                        >
                          <Icon aria-hidden="true" />
                          <span>{item.title}</span>
                          {badge ? (
                            <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-medium text-primary-foreground">
                              {badge}
                            </span>
                          ) : null}
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))}
        </SidebarContent>
        <SidebarFooter className="border-t border-sidebar-border p-3">
          <Button
            variant="outline"
            className="w-full justify-start gap-2 text-xs"
            onClick={handleAiCommand}
          >
            <Sparkles className="h-3.5 w-3.5" />
            AI 보조 명령
            <kbd className="ml-auto inline-flex h-5 items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
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

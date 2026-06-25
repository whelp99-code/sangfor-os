"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  Blocks,
  BookOpen,
  Code2,
  FileText,
  FlaskConical,
  Handshake,
  Inbox,
  LayoutDashboard,
  ListChecks,
  Mail,
  Settings,
  ShieldCheck,
  Terminal,
  TrendingUp,
  Users,
} from "lucide-react";

import {
  Sidebar,
  SidebarContent,
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
import { PROJECT_NAME } from "@sangfor/shared";

import { getVisibleNavItems } from "@/lib/permissions";
import { AppTopbar } from "@/components/shell/app-topbar";

const ICONS = {
  "layout-dashboard": LayoutDashboard,
  users: Users,
  handshake: Handshake,
  "list-checks": ListChecks,
  flask: FlaskConical,
  "trending-up": TrendingUp,
  "file-text": FileText,
  "book-open": BookOpen,
  terminal: Terminal,
  code: Code2,
  activity: Activity,
  inbox: Inbox,
  mail: Mail,
  "shield-check": ShieldCheck,
  blocks: Blocks,
  settings: Settings,
} as const;

export function PortalShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const navItems = getVisibleNavItems();

  return (
    <SidebarProvider>
      <Sidebar>
        <SidebarHeader className="border-b border-sidebar-border px-4 py-3">
          <p className="text-xs font-medium text-muted-foreground">AI Work Portal</p>
          <p className="text-sm font-semibold">{PROJECT_NAME}</p>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Workspace</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {navItems.map((item) => {
                  const Icon = ICONS[item.icon as keyof typeof ICONS] ?? LayoutDashboard;
                  return (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton
                        isActive={pathname.startsWith(item.href)}
                        render={<Link href={item.href} />}
                      >
                        <Icon />
                        <span>{item.title}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
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

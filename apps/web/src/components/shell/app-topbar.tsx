"use client";

import { ProjectSelector } from "@/components/shell/project-selector";
import { PortalShellTrigger } from "@/components/shell/portal-shell";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { MOCK_USER } from "@/lib/portal-config";

export function AppTopbar() {
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
      <PortalShellTrigger />
      <Separator orientation="vertical" className="mr-1 h-6" />
      <ProjectSelector />
      <div className="ml-auto flex items-center gap-2 text-sm">
        <Badge variant="secondary">Phase 3 Registry</Badge>
        <span className="hidden text-muted-foreground sm:inline">{MOCK_USER.name}</span>
      </div>
    </header>
  );
}

"use client"

import { AIWorkspaceLayout, runAgentCommand } from "@/components/ai-workspace"

interface StatItem {
  label: string
  value: string
  type?: "default" | "success" | "warning" | "error"
}

interface DashboardAiShellProps {
  title: string
  subtitle?: string
  activities: React.ComponentProps<typeof AIWorkspaceLayout>["activities"]
  stats?: StatItem[]
  children: React.ReactNode
}

// Split from page.tsx: onCommand is a browser-only closure and can't cross
// the Server → Client prop boundary, but page.tsx must stay server-side to
// load deal-risk data directly from prisma.
export function DashboardAiShell({ title, subtitle, activities, stats, children }: DashboardAiShellProps) {
  return (
    <AIWorkspaceLayout
      title={title}
      subtitle={subtitle}
      activities={activities}
      stats={stats}
      onCommand={(cmd) => runAgentCommand(cmd, "executive")}
    >
      {children}
    </AIWorkspaceLayout>
  )
}

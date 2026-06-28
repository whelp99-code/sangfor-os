"use client"

export const dynamic = "force-dynamic"

import { AIWorkspaceLayout } from "@/components/ai-workspace"
import { ExecutiveDashboard } from "@/components/dashboard/executive-dashboard"

const ACTIVITIES: { id: string; time: string; icon?: React.ReactNode; text: string; type: 'success' | 'info' | 'warning' | 'error' }[] = []

const STATS: { label: string; value: string; type: 'success' | 'warning' | 'error' | 'default' }[] = []

export default function DashboardPage() {
  const handleCommand = (cmd: string) => {
    console.log("[ExecutiveDashboard] Command:", cmd)
  }

  return (
    <AIWorkspaceLayout
      title="Executive Dashboard"
      subtitle="Unified visibility across revenue, delivery, support, and governance"
      activities={ACTIVITIES}
      stats={STATS}
      onCommand={handleCommand}
    >
      <ExecutiveDashboard />
    </AIWorkspaceLayout>
  )
}

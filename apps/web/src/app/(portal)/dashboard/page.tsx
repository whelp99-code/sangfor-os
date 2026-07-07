"use client"

export const dynamic = "force-dynamic"

import { AIWorkspaceLayout, runAgentCommand } from "@/components/ai-workspace"
import { ExecutiveDashboard } from "@/components/dashboard/executive-dashboard"

const ACTIVITIES: { id: string; time: string; icon?: React.ReactNode; text: string; type: 'success' | 'info' | 'warning' | 'error' }[] = []

const STATS: { label: string; value: string; type: 'success' | 'warning' | 'error' | 'default' }[] = []

export default function DashboardPage() {
  const handleCommand = (cmd: string) => runAgentCommand(cmd, "executive")

  return (
    <AIWorkspaceLayout
      title="경영 대시보드"
      subtitle="매출·딜리버리·지원·거버넌스를 한눈에 통합 조망합니다"
      activities={ACTIVITIES}
      stats={STATS}
      onCommand={handleCommand}
    >
      <ExecutiveDashboard />
    </AIWorkspaceLayout>
  )
}

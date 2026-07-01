"use client"

export const dynamic = "force-dynamic"

import { AIWorkspaceLayout } from "@/components/ai-workspace"
import { ExecutiveDashboard } from "@/components/dashboard/executive-dashboard"

const ACTIVITIES: { id: string; time: string; icon?: React.ReactNode; text: string; type: 'success' | 'info' | 'warning' | 'error' }[] = []

const STATS: { label: string; value: string; type: 'success' | 'warning' | 'error' | 'default' }[] = []

export default function DashboardPage() {
  const handleCommand = (_cmd: string) => {
    // TODO(oma-deferred): wire the Executive Dashboard AI assistant when the endpoint is provisioned.
    return "AI 어시스턴트는 준비 중입니다"
  }

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

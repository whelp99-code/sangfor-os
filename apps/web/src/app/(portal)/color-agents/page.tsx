"use client"

export const dynamic = "force-dynamic"

import { AIWorkspaceLayout } from "@/components/ai-workspace"
import { ColorAgentDashboard } from "@/components/color-agents/color-agent-dashboard"

const ACTIVITIES = [
  { id: "1", time: new Date(Date.now() - 30000).toISOString(), text: "Color Review 자동 할당 — 삼성SDS → Blue 검토", type: "info" as const },
  { id: "2", time: new Date(Date.now() - 180000).toISOString(), text: "Blue Review 통과 — 기술검토 완료", type: "success" as const },
  { id: "3", time: new Date(Date.now() - 600000).toISOString(), text: "Red Review 필요 — 리스크 감지됨", type: "warning" as const },
  { id: "4", time: new Date(Date.now() - 1200000).toISOString(), text: "Handoff 발생 — Blue → Orange 이관", type: "info" as const },
  { id: "5", time: new Date(Date.now() - 3600000).toISOString(), text: "Gray Review 실패 — 근거 문서 부족", type: "error" as const },
]

const STATS = [
  { label: "검토 중", value: "12건", type: "warning" as const },
  { label: "통과", value: "45건", type: "success" as const },
  { label: "실패", value: "3건", type: "error" as const },
  { label: "Handoff", value: "7건", type: "default" as const },
]

export default function ColorAgentsPage() {
  const handleCommand = (cmd: string) => {
    console.log("[ColorAgents] Command:", cmd)
  }

  return (
    <AIWorkspaceLayout
      title="Color Agents"
      subtitle="Review perspectives and Kanban handoff owners — they do not replace business personas"
      activities={ACTIVITIES}
      stats={STATS}
      onCommand={handleCommand}
    >
      <ColorAgentDashboard />
    </AIWorkspaceLayout>
  )
}

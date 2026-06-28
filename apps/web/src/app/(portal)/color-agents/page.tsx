"use client"

export const dynamic = "force-dynamic"

import { AIWorkspaceLayout } from "@/components/ai-workspace"
import { ColorAgentDashboard } from "@/components/color-agents/color-agent-dashboard"

const ACTIVITIES: { id: string; time: string; icon?: React.ReactNode; text: string; type: "success" | "info" | "warning" | "error" }[] = []

const STATS: { label: string; value: string; type: "success" | "warning" | "error" | "default" }[] = []

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

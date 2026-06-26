"use client"

export const dynamic = "force-dynamic"

import { AIWorkspaceLayout } from "@/components/ai-workspace"
import { ExecutiveDashboard } from "@/components/dashboard/executive-dashboard"

const ACTIVITIES = [
  { id: "1", time: new Date(Date.now() - 30000).toISOString(), text: "전체 AI 시스템 현황 리포트 생성 완료", type: "success" as const },
  { id: "2", time: new Date(Date.now() - 180000).toISOString(), text: "승인 자동 처리 — KT 유지보수 계약 승인", type: "success" as const },
  { id: "3", time: new Date(Date.now() - 600000).toISOString(), text: "Color Review 통합 리포트 작성 완료", type: "info" as const },
  { id: "4", time: new Date(Date.now() - 1200000).toISOString(), text: "리스크 분석 — 신한은행 Deal 할인율 주의", type: "warning" as const },
  { id: "5", time: new Date(Date.now() - 3600000).toISOString(), text: "주간 파이프라인 예측 업데이트 완료", type: "success" as const },
]

const STATS = [
  { label: "AI 처리 오늘", value: "47건", type: "success" as const },
  { label: "승인 대기", value: "3건", type: "warning" as const },
  { label: "오류", value: "1건", type: "error" as const },
  { label: "처리량", value: "+12%", type: "default" as const },
]

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

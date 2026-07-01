'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { AIWorkspaceLayout } from '@/components/ai-workspace'
import { ActivityItem } from '@/components/ai-workspace/ai-activity-feed'
import { IntegrationHealthPanel } from '@/components/integrations/integration-health-panel'

interface OperatorData {
  systemHealth: Record<string, string>
  workflowQueue: number
  aiUsage: { todayTokens: number; todayCost: number; providerCalls: number }
  toolLogs: any[]
  failedJobs: number
  rlsPolicyCheck: string
  auditIntegrity: string
  backupStatus: string
  tenantHealth: { total: number; healthy: number }
}

// Populated from real system telemetry; empty until wired.
const operatorActivities: ActivityItem[] = []

const rlsPolicyLabel = (v?: string) => (v === 'active' ? '활성' : v ? '비활성' : '-')
const auditIntegrityLabel = (v?: string) => (v === 'verified' ? '검증됨' : v ? '불일치' : '-')
const backupStatusLabel = (v?: string) => (v === 'ok' ? '정상' : v ? '장애' : '-')

const operatorStats: { label: string; value: string; type: 'success' | 'default' | 'warning' | 'error' }[] = []

export default function OperatorPage() {
  const [data, setData] = useState<OperatorData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/dashboard/operator').then(r => r.json()).then(d => { setData(d.result?.data || d); setLoading(false) }).catch(() => setLoading(false))
  }, [])

  function handleCommand(cmd: string) {
    console.log('[Operator] CEO command:', cmd)
  }

  return (
    <AIWorkspaceLayout
      title="운영자 워크스페이스"
      subtitle="W1-W2 안정화 준비 상태 및 역할 기반 운영 대시보드"
      activities={operatorActivities}
      stats={operatorStats}
      onCommand={handleCommand}
    >
      {loading && <div className="grid grid-cols-3 gap-4">{Array.from({length:9}).map((_,i) => <Skeleton key={i} className="h-32" />)}</div>}
      {!loading && (
        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle>안정화 준비 상태</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p>런북: docs/12_VERIFICATION/w1-w2-stabilization-runbook.md</p>
              <p>필수 게이트: 모드 매트릭스, 메일 루프, 상용 게이트, 역할 워크스페이스, 헬스 체크, 데모 시드.</p>
            </CardContent>
          </Card>
          <IntegrationHealthPanel />
          <div className="grid grid-cols-3 gap-4">
        {/* System Health */}
        <Card><CardHeader><CardTitle>시스템 상태</CardTitle></CardHeader>
          <CardContent>
            {data && Object.entries(data.systemHealth).map(([svc, status]) => (
              <div key={svc} className="flex justify-between py-1">
                <span className="text-sm">{svc}</span>
                <Badge variant={status === 'ok' ? 'default' : 'destructive'}>{status === 'ok' ? '정상' : '장애'}</Badge>
              </div>
            ))}
          </CardContent></Card>
        {/* Workflow Queue */}
        <Card><CardHeader><CardTitle>워크플로 큐</CardTitle></CardHeader>
          <CardContent><p className="text-3xl font-bold">{data?.workflowQueue || 0}</p></CardContent></Card>
        {/* AI/LLM Usage */}
        <Card><CardHeader><CardTitle>AI·LLM 사용량</CardTitle></CardHeader>
          <CardContent>
            <p>토큰: {data?.aiUsage.todayTokens.toLocaleString('ko-KR')}</p>
            <p>비용: {data ? `$${data.aiUsage.todayCost.toLocaleString('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '-'}</p>
            <p>호출: {data?.aiUsage.providerCalls}</p>
          </CardContent></Card>
        {/* Failed Jobs */}
        <Card><CardHeader><CardTitle>실패한 작업</CardTitle></CardHeader>
          <CardContent><p className="text-3xl font-bold text-red-500">{data?.failedJobs || 0}</p></CardContent></Card>
        {/* RLS Policy Check */}
        <Card><CardHeader><CardTitle>RLS 정책</CardTitle></CardHeader>
          <CardContent><Badge variant={data?.rlsPolicyCheck === 'active' ? 'default' : 'destructive'}>{rlsPolicyLabel(data?.rlsPolicyCheck)}</Badge></CardContent></Card>
        {/* Audit Integrity */}
        <Card><CardHeader><CardTitle>감사 체인</CardTitle></CardHeader>
          <CardContent><Badge variant={data?.auditIntegrity === 'verified' ? 'default' : 'destructive'}>{auditIntegrityLabel(data?.auditIntegrity)}</Badge></CardContent></Card>
        {/* Backup Status */}
        <Card><CardHeader><CardTitle>백업</CardTitle></CardHeader>
          <CardContent><Badge variant={data?.backupStatus === 'ok' ? 'default' : 'destructive'}>{backupStatusLabel(data?.backupStatus)}</Badge></CardContent></Card>
        {/* Tenant Health */}
        <Card><CardHeader><CardTitle>테넌트 상태</CardTitle></CardHeader>
          <CardContent><p>{data?.tenantHealth.healthy}/{data?.tenantHealth.total} 정상</p></CardContent></Card>
          </div>
        </div>
      )}
    </AIWorkspaceLayout>
  )
}

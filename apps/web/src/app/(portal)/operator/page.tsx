'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { AIWorkspaceLayout } from '@/components/ai-workspace'
import { ActivityItem } from '@/components/ai-workspace/ai-activity-feed'

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

const operatorActivities: ActivityItem[] = [
  { id: 'op1', time: new Date(Date.now() - 1000 * 60 * 1).toISOString(), text: '시스템 상태 모니터링: 모든 서비스 정상', type: 'success' },
  { id: 'op2', time: new Date(Date.now() - 1000 * 60 * 15).toISOString(), text: '워크플로우 자동 실행: 백신 정책 배포 완료', type: 'success' },
  { id: 'op3', time: new Date(Date.now() - 1000 * 60 * 45).toISOString(), text: '장애 감지: DB 커넥션 풀 경고 → 자동 복구', type: 'warning' },
  { id: 'op4', time: new Date(Date.now() - 1000 * 60 * 60 * 6).toISOString(), text: '백업 상태 확인: 전체 테넌트 백업 완료', type: 'info' },
]

const operatorStats = [
  { label: '시스템 상태', value: '정상', type: 'success' as const },
  { label: '워크플로우 대기', value: '4건', type: 'default' as const },
  { label: '실패 작업', value: '0건', type: 'success' as const },
  { label: '백업 상태', value: 'OK', type: 'success' as const },
]

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
      title="Operator Console"
      subtitle="Role-based operational dashboard"
      activities={operatorActivities}
      stats={operatorStats}
      onCommand={handleCommand}
    >
      {loading && <div className="grid grid-cols-3 gap-4">{Array.from({length:9}).map((_,i) => <Skeleton key={i} className="h-32" />)}</div>}
      {!loading && (
        <div className="space-y-6">
          <div className="grid grid-cols-3 gap-4">
        {/* System Health */}
        <Card><CardHeader><CardTitle>System Health</CardTitle></CardHeader>
          <CardContent>
            {data && Object.entries(data.systemHealth).map(([svc, status]) => (
              <div key={svc} className="flex justify-between py-1">
                <span className="text-sm">{svc}</span>
                <Badge variant={status === 'ok' ? 'default' : 'destructive'}>{status === 'ok' ? '정상' : '장애'}</Badge>
              </div>
            ))}
          </CardContent></Card>
        {/* Workflow Queue */}
        <Card><CardHeader><CardTitle>Workflow Queue</CardTitle></CardHeader>
          <CardContent><p className="text-3xl font-bold">{data?.workflowQueue || 0}</p></CardContent></Card>
        {/* AI/LLM Usage */}
        <Card><CardHeader><CardTitle>AI/LLM Usage</CardTitle></CardHeader>
          <CardContent>
            <p>Tokens: {data?.aiUsage.todayTokens.toLocaleString()}</p>
            <p>Cost: ${data?.aiUsage.todayCost.toFixed(2)}</p>
            <p>Calls: {data?.aiUsage.providerCalls}</p>
          </CardContent></Card>
        {/* Failed Jobs */}
        <Card><CardHeader><CardTitle>Failed Jobs</CardTitle></CardHeader>
          <CardContent><p className="text-3xl font-bold text-red-500">{data?.failedJobs || 0}</p></CardContent></Card>
        {/* RLS Policy Check */}
        <Card><CardHeader><CardTitle>RLS Policy</CardTitle></CardHeader>
          <CardContent><Badge variant={data?.rlsPolicyCheck === 'active' ? 'default' : 'destructive'}>{data?.rlsPolicyCheck}</Badge></CardContent></Card>
        {/* Audit Integrity */}
        <Card><CardHeader><CardTitle>Audit Chain</CardTitle></CardHeader>
          <CardContent><Badge variant={data?.auditIntegrity === 'verified' ? 'default' : 'destructive'}>{data?.auditIntegrity}</Badge></CardContent></Card>
        {/* Backup Status */}
        <Card><CardHeader><CardTitle>Backup</CardTitle></CardHeader>
          <CardContent><Badge variant={data?.backupStatus === 'ok' ? 'default' : 'destructive'}>{data?.backupStatus}</Badge></CardContent></Card>
        {/* Tenant Health */}
        <Card><CardHeader><CardTitle>Tenant Health</CardTitle></CardHeader>
          <CardContent><p>{data?.tenantHealth.healthy}/{data?.tenantHealth.total} 정상</p></CardContent></Card>
          </div>
        </div>
      )}
    </AIWorkspaceLayout>
  )
}

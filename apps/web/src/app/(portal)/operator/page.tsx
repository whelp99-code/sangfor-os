'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'

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

export default function OperatorPage() {
  const [data, setData] = useState<OperatorData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/dashboard/operator').then(r => r.json()).then(d => { setData(d.result?.data || d); setLoading(false) }).catch(() => setLoading(false))
  }, [])

  if (loading) return <div className="grid grid-cols-3 gap-4 p-6">{Array.from({length:9}).map((_,i) => <Skeleton key={i} className="h-32" />)}</div>

  return (
    <div className="space-y-6 p-6">
      <h1 className="text-2xl font-bold">Operator Console</h1>
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
  )
}

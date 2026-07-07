'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { AIWorkspaceLayout, runAgentCommand } from '@/components/ai-workspace'
import type { SecurityDashboard } from '@sangfor/business'

export default function SecurityPage() {
  const [data, setData] = useState<SecurityDashboard | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/dashboard/security')
      .then((r) => r.json())
      .then((d) => {
        setData(d)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  function handleCommand(cmd: string) {
    return runAgentCommand(cmd, 'security')
  }

  const derivedStats = data
    ? [
        {
          label: '권한 변경',
          value: `${data.roleChanges}건`,
          type: (data.roleChanges > 0 ? 'warning' : 'success') as 'warning' | 'success',
        },
        {
          label: '특권 접근',
          value: `${data.privilegedAccess}건`,
          type: (data.privilegedAccess > 0 ? 'warning' : 'success') as 'warning' | 'success',
        },
        {
          label: '감사 무결성',
          value: data.auditMismatch ? '불일치' : '정상',
          type: (data.auditMismatch ? 'error' : 'success') as 'error' | 'success',
        },
        {
          label: 'AI 정책 위반',
          value: `${data.aiPolicyViolations}건`,
          type: (data.aiPolicyViolations > 0 ? 'error' : 'success') as 'error' | 'success',
        },
      ]
    : undefined

  return (
    <AIWorkspaceLayout
      title="보안 워크스페이스"
      subtitle="위험 작업 정책, 승인 책임, 감사/증적 준비 상태"
      activities={[]}
      stats={derivedStats}
      onCommand={handleCommand}
    >
      {loading && (
        <div className="space-y-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-48" />
          ))}
        </div>
      )}
      {!loading && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>위험 작업</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p>
                send, export, share, delete, deploy, real-upstream-write,
                production-db-mutation, release-tag
              </p>
              <p>
                모든 위험 작업은 외부 실행 또는 되돌릴 수 없는 실행 전에 승인이
                필요합니다.
              </p>
            </CardContent>
          </Card>
          <div className="grid grid-cols-3 gap-4">
            <Card className="col-span-2">
              <CardHeader>
                <CardTitle>제한 데이터 접근</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground py-2">기록 없음</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>권한 변경</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold">{data?.roleChanges ?? 0}</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>특권 접근</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold">{data?.privilegedAccess ?? 0}</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>감사 무결성</CardTitle>
              </CardHeader>
              <CardContent>
                <Badge variant={data?.auditMismatch ? 'destructive' : 'default'}>
                  {data?.auditMismatch ? '불일치' : '검증됨'}
                </Badge>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>AI 정책 위반</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold text-red-500">
                  {data?.aiPolicyViolations ?? 0}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>내보내기 이벤트</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">기록 없음</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>워크플로 정의 변경</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold">
                  {data?.workflowChanges ?? 0}
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </AIWorkspaceLayout>
  )
}

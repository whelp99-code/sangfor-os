'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

interface SecurityData {
  restrictedAccess: Array<{ user: string; resource: string; reason: string; time: string }>
  roleChanges: { total: number; recent: Array<{ user: string; from: string; to: string; time: string }> }
  privilegedAccess: Array<{ user: string; session: string; started: string }>
  auditMismatch: string
  aiPolicyViolations: number
  exportEvents: Array<{ user: string; target: string; time: string }>
  workflowDefChanges: number
}

export default function SecurityPage() {
  const [data, setData] = useState<SecurityData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/dashboard/security').then(r => r.json()).then(d => { setData(d.result?.data || d); setLoading(false) }).catch(() => setLoading(false))
  }, [])

  if (loading) return <div className="space-y-4 p-6">{Array.from({length:4}).map((_,i) => <Skeleton key={i} className="h-48" />)}</div>

  return (
    <div className="space-y-6 p-6">
      <h1 className="text-2xl font-bold">Security Dashboard</h1>
      <div className="grid grid-cols-3 gap-4">
        {/* Restricted Data Access */}
        <Card className="col-span-2"><CardHeader><CardTitle>Restricted Data Access</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Resource</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.restrictedAccess.map((e, i) => (
                  <TableRow key={i}>
                    <TableCell>{e.user}</TableCell>
                    <TableCell>{e.resource}</TableCell>
                    <TableCell>{e.reason}</TableCell>
                    <TableCell className="text-xs">{e.time}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent></Card>
        {/* Role Changes */}
        <Card><CardHeader><CardTitle>Role Changes</CardTitle></CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{data?.roleChanges.total || 0}</p>
            <div className="mt-4 space-y-2">
              {data?.roleChanges.recent.slice(0, 3).map((rc, i) => (
                <div key={i} className="text-xs border-b pb-1">
                  <p><strong>{rc.user}</strong>: {rc.from} → {rc.to}</p>
                  <p className="text-muted-foreground">{rc.time}</p>
                </div>
              ))}
            </div>
          </CardContent></Card>
        {/* Privileged Access */}
        <Card><CardHeader><CardTitle>Privileged Access</CardTitle></CardHeader>
          <CardContent>
            <p className="text-sm font-medium mb-2">Active Sessions</p>
            {data?.privilegedAccess.map((pa, i) => (
              <div key={i} className="flex justify-between text-xs py-1">
                <span>{pa.user}</span>
                <span className="text-muted-foreground">{pa.session}</span>
              </div>
            ))}
          </CardContent></Card>
        {/* Audit Mismatch */}
        <Card><CardHeader><CardTitle>Audit Integrity</CardTitle></CardHeader>
          <CardContent>
            <Badge variant={data?.auditMismatch === 'verified' ? 'default' : 'destructive'}>{data?.auditMismatch}</Badge>
          </CardContent></Card>
        {/* AI Policy Violations */}
        <Card><CardHeader><CardTitle>AI Policy Violations</CardTitle></CardHeader>
          <CardContent><p className="text-3xl font-bold text-red-500">{data?.aiPolicyViolations || 0}</p></CardContent></Card>
        {/* Export Events */}
        <Card><CardHeader><CardTitle>Export Events</CardTitle></CardHeader>
          <CardContent>
            {data?.exportEvents.slice(0, 4).map((ev, i) => (
              <div key={i} className="flex justify-between text-xs py-1 border-b last:border-0">
                <span>{ev.user} → {ev.target}</span>
                <span className="text-muted-foreground">{ev.time}</span>
              </div>
            ))}
          </CardContent></Card>
        {/* Workflow Definition Changes */}
        <Card><CardHeader><CardTitle>Workflow Definition Changes</CardTitle></CardHeader>
          <CardContent><p className="text-3xl font-bold">{data?.workflowDefChanges || 0}</p></CardContent></Card>
      </div>
    </div>
  )
}

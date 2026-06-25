'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

type MailStatus = {
  configured: boolean
  connected: boolean
  accountCount: number
  messageCount: number
  providers: Array<{ name: string; configured: boolean; connected: boolean }>
}

export default function MailConnectionPage() {
  const [status, setStatus] = useState<MailStatus | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/mail-status').then(r => r.json()).then(setStatus)
  }, [])

  const handleSync = async () => {
    setSyncing(true)
    setSyncResult(null)
    try {
      const res = await fetch('/api/mail-import', { method: 'POST' })
      const data = await res.json()
      setSyncResult(data.success ? `Synced ${data.synced} messages` : `Error: ${data.error}`)
      const updated = await fetch('/api/mail-status').then(r => r.json())
      setStatus(updated)
    } catch {
      setSyncResult('Sync request failed')
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Mail Connection</h1>
        <p className="text-muted-foreground">Outlook 365 connector configuration and status</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {status?.providers.map(p => (
          <Card key={p.name}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">{p.name}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <span className={`inline-block h-3 w-3 rounded-full ${p.configured ? (p.connected ? 'bg-green-500' : 'bg-yellow-500') : 'bg-red-500'}`} />
                <span className="text-sm">
                  {p.configured ? (p.connected ? 'Connected' : 'Configured') : 'Not configured'}
                </span>
              </div>
            </CardContent>
          </Card>
        ))}

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Mail Accounts</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{status?.accountCount ?? 0}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Messages</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{status?.messageCount ?? 0}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Manual Sync</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <button
            onClick={handleSync}
            disabled={syncing || !status?.configured}
            className="inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {syncing ? 'Syncing...' : 'Sync Now'}
          </button>
          {syncResult && <p className="text-sm text-muted-foreground">{syncResult}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Configuration Guide</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>Set these environment variables to connect Outlook 365:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li><code className="rounded bg-muted px-1">OUTLOOK_CLIENT_ID</code> — Azure AD app client ID</li>
            <li><code className="rounded bg-muted px-1">OUTLOOK_CLIENT_SECRET</code> — Azure AD app client secret</li>
            <li><code className="rounded bg-muted px-1">OUTLOOK_TENANT_ID</code> — Azure AD tenant ID</li>
          </ul>
          <p className="pt-2">Alternatively, <code className="rounded bg-muted px-1">AZURE_CLIENT_ID</code>, <code className="rounded bg-muted px-1">AZURE_CLIENT_SECRET</code>, and <code className="rounded bg-muted px-1">AZURE_TENANT_ID</code> are used as fallback.</p>
        </CardContent>
      </Card>
    </div>
  )
}

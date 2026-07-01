'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

type MailStatus = {
  configured: boolean
  connected: boolean
  accountCount: number
  messageCount: number
  oauthConfigured?: boolean
  delegated?: { connected: boolean; email?: string; lastSyncedAt?: string | null }
  providers: Array<{ name: string; configured: boolean; connected: boolean }>
}

export default function MailConnectionPage() {
  const [status, setStatus] = useState<MailStatus | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => {
    fetch('/api/mail-status').then(r => r.json()).then(setStatus)
    const params = new URLSearchParams(window.location.search)
    if (params.get('connected')) {
      setNotice({ kind: 'success', text: `연결됨: ${params.get('connected')}` })
      window.history.replaceState({}, '', '/mail-connection')
    } else if (params.get('error')) {
      setNotice({ kind: 'error', text: decodeURIComponent(params.get('error') as string) })
      window.history.replaceState({}, '', '/mail-connection')
    }
  }, [])

  const handleSync = async () => {
    setSyncing(true)
    setSyncResult(null)
    try {
      setSyncResult('받은/보낸 메일 전체 가져오는 중…')
      const importRes = await fetch('/api/mail-import', { method: 'POST' }).then(r => r.json())
      if (!importRes.success) {
        setSyncResult(`오류: ${importRes.error}`)
        return
      }
      setSyncResult(`메일 ${importRes.synced}건 (받은 ${importRes.inbox ?? '?'} / 보낸 ${importRes.sent ?? '?'}) 동기화 완료. 대화 단위로 학습 중…`)
      const learnRes = await fetch('/api/mail-learn', { method: 'POST' }).then(r => r.json())
      if (learnRes.success) {
        const created = learnRes.candidates?.created ?? learnRes.candidates?.candidatesCreated
        setSyncResult(
          `완료 — 메일 ${importRes.synced}건, 스레드 ${learnRes.threads}개 학습` +
            (created != null ? `, 후보 ${created}건 생성` : ''),
        )
      } else {
        setSyncResult(`동기화 ${importRes.synced}건 완료, 학습 오류: ${learnRes.error}`)
      }
      const updated = await fetch('/api/mail-status').then(r => r.json())
      setStatus(updated)
    } catch {
      setSyncResult('동기화 요청에 실패했습니다')
    } finally {
      setSyncing(false)
    }
  }

  const handleCalendarSync = async () => {
    setSyncing(true)
    setSyncResult('Outlook 캘린더 미팅 가져오는 중…')
    try {
      const res = await fetch('/api/mail/calendar-sync', { method: 'POST' }).then(r => r.json())
      setSyncResult(
        res.success
          ? `캘린더 — 이벤트 ${res.fetched}건 조회, 영업기회 매칭 ${res.matched}건, 미팅 ${res.created}건 생성`
          : `캘린더 오류: ${res.error}`,
      )
    } catch {
      setSyncResult('캘린더 동기화에 실패했습니다')
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">메일 연동</h1>
        <p className="text-muted-foreground">Outlook 365 커넥터 설정 및 상태</p>
      </div>

      {notice && (
        <div
          className={`rounded-lg border p-3 text-sm ${
            notice.kind === 'success'
              ? 'border-green-200 bg-green-50 text-green-700 dark:border-green-900/50 dark:bg-green-950/20'
              : 'border-red-200 bg-red-50 text-red-700 dark:border-red-900/50 dark:bg-red-950/20'
          }`}
        >
          {notice.text}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>메일함 연결</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {status?.delegated?.connected ? (
            <p className="text-sm">
              <span className="font-medium">{status.delegated.email}</span> 계정으로 연결됨
              {status.delegated.lastSyncedAt
                ? ` · 마지막 동기화 ${new Date(status.delegated.lastSyncedAt).toLocaleString()}`
                : ''}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Microsoft 로그인으로 개인 또는 회사 Outlook 계정을 인증하세요.
            </p>
          )}
          <a
            href="/api/mail/oauth/authorize"
            aria-disabled={!status?.oauthConfigured}
            className={`inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-medium ${
              status?.oauthConfigured
                ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                : 'pointer-events-none bg-muted text-muted-foreground opacity-50'
            }`}
          >
            {status?.delegated?.connected ? 'Outlook 재연결' : 'Outlook 연결'}
          </a>
          {!status?.oauthConfigured && (
            <p className="text-xs text-muted-foreground">
              로그인을 활성화하려면 <code className="rounded bg-muted px-1">OUTLOOK_CLIENT_ID</code>와{' '}
              <code className="rounded bg-muted px-1">OUTLOOK_CLIENT_SECRET</code>를 설정하세요.
            </p>
          )}
        </CardContent>
      </Card>

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
                  {p.configured ? (p.connected ? '연결됨' : '설정됨') : '미설정'}
                </span>
              </div>
            </CardContent>
          </Card>
        ))}

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">메일 계정</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{status?.accountCount ?? 0}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">메일 건수</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{status?.messageCount ?? 0}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>동기화 및 학습</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            받은 메일과 보낸 메일 전체를 가져와 대화(스레드) 단위로 묶어 학습합니다.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={handleSync}
              disabled={syncing || !status?.connected}
              className="inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {syncing ? '처리 중…' : '전체 메일 가져와서 학습'}
            </button>
            <button
              onClick={handleCalendarSync}
              disabled={syncing || !status?.connected}
              className="inline-flex items-center justify-center rounded-lg border px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
            >
              캘린더 미팅 가져오기
            </button>
          </div>
          {syncResult && <p className="text-sm text-muted-foreground">{syncResult}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>설정 가이드</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>Azure 앱(개인 + 회사 계정)을 등록한 뒤 다음을 설정하세요:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li><code className="rounded bg-muted px-1">OUTLOOK_CLIENT_ID</code> — Azure 앱(클라이언트) ID</li>
            <li><code className="rounded bg-muted px-1">OUTLOOK_CLIENT_SECRET</code> — Azure 앱 클라이언트 시크릿</li>
            <li><code className="rounded bg-muted px-1">OUTLOOK_TENANT_ID</code> — 개인 계정은 비워 두거나 <code className="rounded bg-muted px-1">common</code></li>
            <li><code className="rounded bg-muted px-1">OUTLOOK_REDIRECT_URI</code> — Azure 리디렉션 URI와 일치해야 함</li>
          </ul>
          <p className="pt-2">필요한 위임 권한: <code className="rounded bg-muted px-1">Mail.Read</code>, <code className="rounded bg-muted px-1">offline_access</code>, <code className="rounded bg-muted px-1">User.Read</code>. 그런 다음 위의 <span className="font-medium">Outlook 연결</span>을 클릭하세요.</p>
        </CardContent>
      </Card>
    </div>
  )
}

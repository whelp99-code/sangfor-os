import { NextResponse } from 'next/server'
import { OutlookSyncService } from '@sangfor/business'
import { getDelegatedConnection, isOutlookOAuthConfigured } from '@/lib/outlook-graph'

export async function GET() {
  const sync = new OutlookSyncService()
  const status = await sync.getStatus()
  const delegated = await getDelegatedConnection()
  const oauthConfigured = isOutlookOAuthConfigured()

  const configured = oauthConfigured || status.configured
  const connected = delegated.connected || status.connected

  const providers = [
    { name: 'Outlook 365', configured, connected },
    { name: 'IMAP (fallback)', configured: false, connected: false },
  ]

  return NextResponse.json({ providers, ...status, configured, connected, oauthConfigured, delegated })
}

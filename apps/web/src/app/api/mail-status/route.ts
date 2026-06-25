import { NextResponse } from 'next/server'
import { OutlookSyncService } from '@sangfor/business'

export async function GET() {
  const sync = new OutlookSyncService()
  const status = await sync.getStatus()

  const providers = [
    { name: 'Outlook 365', configured: status.configured, connected: status.connected },
    { name: 'IMAP (fallback)', configured: false, connected: false },
  ]

  return NextResponse.json({ providers, ...status })
}

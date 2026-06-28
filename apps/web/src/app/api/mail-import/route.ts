import { NextResponse } from 'next/server'
import { OutlookSyncService } from '@sangfor/business'
import { getDelegatedConnection, syncDelegatedOutlook } from '@/lib/outlook-graph'

export async function POST() {
  // Prefer the delegated (user-connected) mailbox when available.
  const connection = await getDelegatedConnection()
  if (connection.connected) {
    try {
      const result = await syncDelegatedOutlook()
      return NextResponse.json({ success: true, mode: 'delegated', ...result })
    } catch (error) {
      return NextResponse.json(
        { success: false, error: error instanceof Error ? error.message : 'sync_failed' },
        { status: 200 },
      )
    }
  }

  // Fall back to app-only (client_credentials) sync if configured.
  const sync = new OutlookSyncService()
  if (!sync.isConfigured()) {
    return NextResponse.json({
      success: false,
      error: 'Outlook not connected. Click "Connect Outlook" to authorize a mailbox.',
      fallbackMode: true,
    }, { status: 200 })
  }

  const result = await sync.syncToDatabase()
  return NextResponse.json({ success: true, mode: 'app-only', ...result })
}

export async function GET() {
  const sync = new OutlookSyncService()
  const status = await sync.getStatus()
  return NextResponse.json(status)
}

import { NextResponse } from 'next/server'
import { OutlookSyncService } from '@sangfor/business'

export async function POST() {
  const sync = new OutlookSyncService()

  if (!sync.isConfigured()) {
    return NextResponse.json({
      success: false,
      error: 'Outlook 365 not configured. Set OUTLOOK_CLIENT_ID, OUTLOOK_CLIENT_SECRET, OUTLOOK_TENANT_ID',
      fallbackMode: true,
    }, { status: 200 })
  }

  const result = await sync.syncToDatabase()
  return NextResponse.json({ success: true, ...result })
}

export async function GET() {
  const sync = new OutlookSyncService()
  const status = await sync.getStatus()
  return NextResponse.json(status)
}

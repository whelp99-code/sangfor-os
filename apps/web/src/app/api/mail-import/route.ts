import { NextResponse } from 'next/server'
import { OutlookSyncService } from '@sangfor/business'
import { syncOutlook } from '@/lib/outlook'
import { assertApiAccess } from '@/lib/api-auth'

export async function POST(request: Request) {
  const denied = assertApiAccess(request)
  if (denied) return denied
  const result = await syncOutlook({ preferDelegated: true })
  return NextResponse.json(result, { status: 200 })
}

export async function GET() {
  const sync = new OutlookSyncService()
  const status = await sync.getStatus()
  return NextResponse.json(status)
}

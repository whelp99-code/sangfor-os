import { NextResponse } from 'next/server'
import { OutlookSyncService } from '@sangfor/business'
import { syncOutlook } from '@/lib/outlook'
import { assertApiAccess } from '@/lib/api-auth'
import { assertBusinessCapability } from '@/lib/auth/authorization'
import { financeCallerFor } from '@/lib/finance-caller'

export async function POST(request: Request) {
  const denied = assertApiAccess(request)
  if (denied) return denied
  const capabilityDenied = await assertBusinessCapability(request, 'apps/web/src/app/api/mail-import/route.ts')
  if (capabilityDenied) return capabilityDenied
  // Hometax invoices are ingested through the CFO API, which only accepts a
  // finance principal minted from this request's own session.
  const result = await syncOutlook({ preferDelegated: true, financeFetch: financeCallerFor(request) })
  return NextResponse.json(result, { status: 200 })
}

export async function GET() {
  const sync = new OutlookSyncService()
  const status = await sync.getStatus()
  return NextResponse.json(status)
}

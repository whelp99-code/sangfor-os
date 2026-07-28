import { NextResponse } from 'next/server'
import { learnFromMailbox } from '@/lib/mail-learning'
import { assertApiAccess } from '@/lib/api-auth'
import { assertBusinessCapability } from '@/lib/auth/authorization'

// Group synced sent + received mail into conversation threads and classify them
// into business candidates. Long-running; called after /api/mail-import.
export async function POST(request: Request) {
  const denied = assertApiAccess(request)
  if (denied) return denied
  const capabilityDenied = await assertBusinessCapability(request, 'apps/web/src/app/api/mail-learn/route.ts')
  if (capabilityDenied) return capabilityDenied
  try {
    const result = await learnFromMailbox()
    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    console.error('[api] learn_failed:', error instanceof Error ? error.stack ?? error.message : error)
    return NextResponse.json(
      { success: false, error: 'learn_failed' },
      { status: 200 },
    )
  }
}

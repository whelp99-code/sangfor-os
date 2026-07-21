import { NextResponse } from 'next/server'
import { syncCalendarMeetings } from '@/lib/outlook'
import { apiError, assertApiAccess } from '@/lib/api-auth'
import { assertBusinessCapability } from '@/lib/auth/authorization'

// P7 #5: pull Outlook calendar meetings and attach them to opportunities matched
// by attendee email domain → customer → opportunity. Calendar events become
// confirmed MeetingNotes that conversion can absorb.
export async function POST(request: Request) {
  const denied = assertApiAccess(request)
  if (denied) return denied
  const capabilityDenied = await assertBusinessCapability(request, 'apps/web/src/app/api/mail/calendar-sync/route.ts')
  if (capabilityDenied) return capabilityDenied
  try {
    const result = await syncCalendarMeetings()
    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    return apiError('calendar_sync_failed', error, {
      status: 200,
      extra: { success: false },
    })
  }
}

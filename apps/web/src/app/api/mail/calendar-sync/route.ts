import { NextResponse } from 'next/server'
import { syncCalendarMeetings } from '@/lib/outlook-graph'
import { apiError, assertApiAccess } from '@/lib/api-auth'

// P7 #5: pull Outlook calendar meetings and attach them to opportunities matched
// by attendee email domain → customer → opportunity. Calendar events become
// confirmed MeetingNotes that conversion can absorb.
export async function POST(request: Request) {
  const denied = assertApiAccess(request)
  if (denied) return denied
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

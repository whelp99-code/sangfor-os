import { NextResponse } from 'next/server'
import { syncCalendarMeetings } from '@/lib/outlook-graph'

// P7 #5: pull Outlook calendar meetings and attach them to opportunities matched
// by attendee email domain → customer → opportunity. Calendar events become
// confirmed MeetingNotes that conversion can absorb.
export async function POST() {
  try {
    const result = await syncCalendarMeetings()
    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'calendar_sync_failed' },
      { status: 200 },
    )
  }
}

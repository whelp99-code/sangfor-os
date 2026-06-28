import { NextResponse } from 'next/server'
import { learnFromMailbox } from '@/lib/mail-learning'

// Group synced sent + received mail into conversation threads and classify them
// into business candidates. Long-running; called after /api/mail-import.
export async function POST() {
  try {
    const result = await learnFromMailbox()
    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'learn_failed' },
      { status: 200 },
    )
  }
}

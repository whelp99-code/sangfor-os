import { recordHumanDecision } from '@sangfor/business';
import { NextResponse } from 'next/server';
import { assertApiAccess } from '@/lib/api-auth';
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = assertApiAccess(req);
  if (denied) return denied;
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  if (!body.domain || !body.outcome) return NextResponse.json({ error: 'domain and outcome required' }, { status: 400 });
  const r = await recordHumanDecision({ engagementId: id, domain: body.domain, outcome: body.outcome, output: body.output, humanEdit: body.humanEdit, note: body.note });
  return NextResponse.json(r);
}

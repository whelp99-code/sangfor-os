import { recordHumanDecision } from '@sangfor/business';
import { NextResponse } from 'next/server';
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  if (!body.domain || !body.outcome) return NextResponse.json({ error: 'domain and outcome required' }, { status: 400 });
  const r = await recordHumanDecision({ engagementId: id, domain: body.domain, outcome: body.outcome, output: body.output, humanEdit: body.humanEdit, note: body.note });
  return NextResponse.json(r);
}

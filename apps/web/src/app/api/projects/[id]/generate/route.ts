import { generateDomainProposal, getProjectHub, DOMAIN_ORDER } from '@sangfor/business';
import { NextResponse } from 'next/server';
import { assertApiAccess } from '@/lib/api-auth';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = assertApiAccess(req);
  if (denied) return denied;
  try {
    const { id } = await params;
    const body = await req.json().catch(() => ({})) as { domain?: string };

    if (!body.domain || !DOMAIN_ORDER.includes(body.domain as (typeof DOMAIN_ORDER)[number])) {
      return NextResponse.json({ error: 'invalid domain' }, { status: 400 });
    }

    // Load engagement info for the prompt
    const hub = await getProjectHub(id);
    if (!hub) {
      return NextResponse.json({ error: 'engagement not found' }, { status: 404 });
    }

    // hub.engagement is guaranteed non-null when getProjectHub returns a hub
    const engagement = hub.engagement!;
    const proposal = await generateDomainProposal({
      engagementId: id,
      domain: body.domain as import('@sangfor/business').DomainKey,
      engagementName: engagement.name ?? id,
      customerName: engagement.opportunity?.customer?.name ?? undefined,
    });

    return NextResponse.json(proposal);
  } catch (err) {
    // Graceful: never 500 the UI — return 200 with a generic {error}.
    // Log the real cause server-side to avoid leaking internals to clients.
    console.error('[api] generate_failed:', err instanceof Error ? err.stack ?? err.message : err);
    return NextResponse.json({ error: 'generate_failed' });
  }
}

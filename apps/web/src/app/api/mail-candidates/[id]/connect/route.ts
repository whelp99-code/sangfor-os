import { approveAndConnectMailCandidate } from "@sangfor/business/mail-candidate-connections";
import { NextResponse } from "next/server";
import { apiError, assertApiAccess } from "@/lib/api-auth";
import { assertBusinessCapability } from "@/lib/auth/authorization";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const denied = assertApiAccess(request);
  if (denied) return denied;
  const capabilityDenied = await assertBusinessCapability(request, "apps/web/src/app/api/mail-candidates/[id]/connect/route.ts");
  if (capabilityDenied) return capabilityDenied;
  const { id } = await params;
  try {
    const body = await request.json();
    const result = await approveAndConnectMailCandidate({
      ...body,
      candidateId: id,
    });
    return NextResponse.json({
      ...result,
      redirectTo: result.proposal?.id
        ? `/proposals/${result.proposal.id}`
        : `/deals/${result.opportunity.id}`,
    });
  } catch (error) {
    return apiError("connect_failed", error, { status: 400 });
  }
}

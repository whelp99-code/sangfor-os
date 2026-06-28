import { approveAndConnectMailCandidate } from "@sangfor/business/mail-candidate-connections";
import { NextResponse } from "next/server";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
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
        : `/opportunities/${result.opportunity.id}`,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "connect_failed" },
      { status: 400 },
    );
  }
}

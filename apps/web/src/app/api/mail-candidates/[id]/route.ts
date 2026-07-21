import {
  approveMailDerivedCandidate,
  CandidateConversionInProgressError,
  getMailDerivedCandidate,
  revalidateMailDerivedCandidate,
  rejectMailDerivedCandidate,
  setCandidateType,
} from "@sangfor/business/mail-candidates";
import { NextResponse } from "next/server";
import { apiError, assertApiAccess } from "@/lib/api-auth";
import { assertBusinessCapability } from "@/lib/auth/authorization";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const candidate = await getMailDerivedCandidate(id);
  return NextResponse.json({ candidate });
}

export async function PATCH(request: Request, { params }: Params) {
  const denied = assertApiAccess(request);
  if (denied) return denied;
  const capabilityDenied = await assertBusinessCapability(request, "apps/web/src/app/api/mail-candidates/[id]/route.ts");
  if (capabilityDenied) return capabilityDenied;
  const { id } = await params;
  try {
    const body = await request.json();
    if (body.status === "approved" || body.action === "approve") {
      const result = await approveMailDerivedCandidate(id);
      return NextResponse.json(result);
    }
    if (body.action === "revalidate") {
      const result = await revalidateMailDerivedCandidate(id);
      return NextResponse.json(result);
    }
    if (body.status === "rejected" || body.action === "reject") {
      const candidate = await rejectMailDerivedCandidate(id, {
        reasonCode: body.reasonCode ?? "manual_reject",
        note: body.note,
      });
      return NextResponse.json({ candidate });
    }
    if (body.action === "set_candidate_type") {
      const candidate = await setCandidateType(id, { candidateType: body.candidateType });
      return NextResponse.json({ candidate });
    }
    return NextResponse.json({ error: "unsupported_action" }, { status: 400 });
  } catch (error) {
    if (error instanceof CandidateConversionInProgressError) {
      return apiError("candidate_conversion_in_progress", error, { status: 409 });
    }
    return apiError("patch_failed", error, { status: 400 });
  }
}

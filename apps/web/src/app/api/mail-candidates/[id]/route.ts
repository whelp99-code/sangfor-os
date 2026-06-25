import {
  approveMailDerivedCandidate,
  getMailDerivedCandidate,
  revalidateMailDerivedCandidate,
  rejectMailDerivedCandidate,
} from "@ai-portal/automation/mail-candidates";
import { NextResponse } from "next/server";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const candidate = await getMailDerivedCandidate(id);
  return NextResponse.json({ candidate });
}

export async function PATCH(request: Request, { params }: Params) {
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
    return NextResponse.json({ error: "unsupported_action" }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "patch_failed" },
      { status: 400 },
    );
  }
}

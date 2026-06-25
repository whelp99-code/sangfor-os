import {
  approveImprovementCandidate,
  getImprovementCandidate,
  rejectImprovementCandidate,
} from "@sangfor/business/improvement-loop";
import { NextResponse } from "next/server";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const candidate = await getImprovementCandidate(id);
  if (!candidate) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ candidate });
}

export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;
  try {
    const body = await request.json();
    const status = body?.status as string | undefined;
    if (status === "approved") {
      const candidate = await approveImprovementCandidate(id);
      return NextResponse.json({ candidate });
    }
    if (status === "rejected") {
      const candidate = await rejectImprovementCandidate(id);
      return NextResponse.json({ candidate });
    }
    return NextResponse.json({ error: "invalid_status" }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "patch_failed" },
      { status: 400 },
    );
  }
}

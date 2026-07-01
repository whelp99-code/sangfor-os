import { prisma } from "@sangfor/db";
import { NextResponse } from "next/server";
import { apiError, assertApiAccess } from "@/lib/api-auth";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const denied = assertApiAccess(request);
  if (denied) return denied;
  const { id } = await params;
  try {
    const body = await request.json();
    const status = body.status ?? "active";
    const updated = await prisma.policyMemory.update({
      where: { id },
      data: { status },
    });
    return NextResponse.json({ policyMemory: updated });
  } catch (error) {
    return apiError("patch_failed", error, { status: 400 });
  }
}

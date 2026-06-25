import { prisma } from "@sangfor/db";
import { NextResponse } from "next/server";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
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
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "patch_failed" },
      { status: 400 },
    );
  }
}

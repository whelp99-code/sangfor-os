import { resolveDefaultProjectId } from "@sangfor/business";
import { prisma } from "@sangfor/db";
import { NextResponse } from "next/server";

import { apiError } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const projectId = await resolveDefaultProjectId();
    const project = await prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      select: { id: true, slug: true, name: true },
    });
    return NextResponse.json({ project });
  } catch (error) {
    return apiError("default_project_not_found", error, { status: 404 });
  }
}

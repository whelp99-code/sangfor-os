import { resolveDefaultProjectId } from "@sangfor/business";
import { getRoleDashboardData } from "@sangfor/business/role-dashboard-data";
import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-auth";

export async function GET(
  request: Request,
  { params }: { params: Promise<any> },
) {
  const { role } = await params;
  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get("projectId") ?? (await resolveDefaultProjectId());
    const data = await getRoleDashboardData(role, projectId);
    if (data == null) {
      return NextResponse.json({ error: `Unknown dashboard role: ${role}` }, { status: 404 });
    }
    return NextResponse.json(data);
  } catch (error) {
    return apiError(`${role}_dashboard_failed`, error, { status: 500 });
  }
}

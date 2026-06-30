import { archivePartner, getPartnerDetail, updatePartner } from "@sangfor/business";
import { NextResponse } from "next/server";
import { apiError, assertApiAccess } from "@/lib/api-auth";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  try {
    const partner = await getPartnerDetail(id);
    if (!partner) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json({ partner });
  } catch (error) {
    return apiError("fetch_failed", error, { status: 500 });
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const denied = assertApiAccess(request);
  if (denied) return denied;
  const { id } = await context.params;
  try {
    const body = await request.json();
    const partner = await updatePartner(id, body);
    return NextResponse.json({ partner });
  } catch (error) {
    return apiError("update_failed", error, { status: 400 });
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const denied = assertApiAccess(request);
  if (denied) return denied;
  const { id } = await context.params;
  try {
    const partner = await archivePartner(id);
    return NextResponse.json({ partner });
  } catch (error) {
    return apiError("archive_failed", error, { status: 400 });
  }
}

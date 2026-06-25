import { archivePartner, getPartnerDetail, updatePartner } from "@sangfor/business";
import { NextResponse } from "next/server";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  try {
    const partner = await getPartnerDetail(id);
    if (!partner) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json({ partner });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "fetch_failed" },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;
  try {
    const body = await request.json();
    const partner = await updatePartner(id, body);
    return NextResponse.json({ partner });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "update_failed" },
      { status: 400 },
    );
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  try {
    const partner = await archivePartner(id);
    return NextResponse.json({ partner });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "archive_failed" },
      { status: 400 },
    );
  }
}

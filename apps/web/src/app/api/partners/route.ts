import { createPartner, listPartners } from "@sangfor/business";
import { NextResponse } from "next/server";
import { apiError, assertApiAccess } from "@/lib/api-auth";

export async function GET() {
  try {
    const partners = await listPartners();
    return NextResponse.json({ partners });
  } catch (error) {
    return apiError("list_failed", error, { status: 500 });
  }
}

export async function POST(request: Request) {
  const denied = assertApiAccess(request);
  if (denied) return denied;
  try {
    const body = await request.json();
    const partner = await createPartner(body);
    return NextResponse.json({ partner }, { status: 201 });
  } catch (error) {
    return apiError("create_failed", error, { status: 400 });
  }
}

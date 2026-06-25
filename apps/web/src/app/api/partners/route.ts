import { createPartner, listPartners } from "@sangfor/business";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const partners = await listPartners();
    return NextResponse.json({ partners });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "list_failed" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const partner = await createPartner(body);
    return NextResponse.json({ partner }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "create_failed" },
      { status: 400 },
    );
  }
}

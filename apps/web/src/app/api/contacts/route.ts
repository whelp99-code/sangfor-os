import { createContact } from "@sangfor/business";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const contact = await createContact(body);
    return NextResponse.json({ contact }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "create_failed" },
      { status: 400 },
    );
  }
}

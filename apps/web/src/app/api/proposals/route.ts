import { generateProposal, listGeneratedDocuments } from "@sangfor/business";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const documents = await listGeneratedDocuments();
    return NextResponse.json({ documents });
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
    const document = await generateProposal(body);
    return NextResponse.json({ document }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "generate_failed" },
      { status: 400 },
    );
  }
}

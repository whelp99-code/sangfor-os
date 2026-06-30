import { generateProposal, listGeneratedDocuments } from "@sangfor/business";
import { NextResponse } from "next/server";
import { apiError, assertApiAccess } from "@/lib/api-auth";

export async function GET() {
  try {
    const documents = await listGeneratedDocuments();
    return NextResponse.json({ documents });
  } catch (error) {
    return apiError("list_failed", error, { status: 500 });
  }
}

export async function POST(request: Request) {
  const denied = assertApiAccess(request);
  if (denied) return denied;
  try {
    const body = await request.json();
    const document = await generateProposal(body);
    return NextResponse.json({ document }, { status: 201 });
  } catch (error) {
    return apiError("generate_failed", error, { status: 400 });
  }
}

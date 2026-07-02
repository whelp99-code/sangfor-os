import { generateMailInsightThreads } from "@sangfor/business";
import { NextResponse } from "next/server";
import { apiError, assertApiAccess } from "@/lib/api-auth";

export async function POST(request: Request) {
  const denied = assertApiAccess(request);
  if (denied) return denied;
  try {
    const body = await request.json().catch(() => ({}));
    const limit = Math.min(Number(body.limit ?? 100), 2000);

    const result = await generateMailInsightThreads(limit);

    return NextResponse.json(
      {
        success: true,
        ...result,
      },
      { status: 201 },
    );
  } catch (error) {
    return apiError("generate_failed", error, { status: 400 });
  }
}

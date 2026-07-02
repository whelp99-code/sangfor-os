import { extractDomainPipeline } from "@sangfor/business";
import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const snapshot = await extractDomainPipeline("demo-project");
    return NextResponse.json(snapshot);
  } catch (error) {
    return apiError("domain_pipeline_failed", error, { status: 400 });
  }
}

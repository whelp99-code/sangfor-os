import { NextResponse } from "next/server";
import { getLlmSettingsStatus, saveLlmSettings } from "@sangfor/business";
import { apiError, assertApiAccess } from "@/lib/api-auth";

// Web-managed OpenAI-compatible LLM credentials (no OAuth for OpenAI APIs).
// GET returns a masked status; the full key is never returned.
export async function GET() {
  try {
    return NextResponse.json(await getLlmSettingsStatus());
  } catch (error) {
    return apiError("status_failed", error, { status: 500 });
  }
}

export async function POST(request: Request) {
  const denied = assertApiAccess(request);
  if (denied) return denied;
  try {
    const body = await request.json().catch(() => ({}));
    await saveLlmSettings({
      apiKey: typeof body.apiKey === "string" ? body.apiKey : undefined,
      baseUrl: typeof body.baseUrl === "string" ? body.baseUrl : undefined,
      model: typeof body.model === "string" ? body.model : undefined,
    });
    return NextResponse.json({ success: true, ...(await getLlmSettingsStatus()) });
  } catch (error) {
    return apiError("save_failed", error, { status: 400, extra: { success: false } });
  }
}

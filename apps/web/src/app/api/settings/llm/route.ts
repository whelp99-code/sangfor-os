import { NextResponse } from "next/server";
import { getLlmSettingsStatus, saveLlmSettings } from "@sangfor/business";

// Web-managed OpenAI-compatible LLM credentials (no OAuth for OpenAI APIs).
// GET returns a masked status; the full key is never returned.
export async function GET() {
  try {
    return NextResponse.json(await getLlmSettingsStatus());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "status_failed" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    await saveLlmSettings({
      apiKey: typeof body.apiKey === "string" ? body.apiKey : undefined,
      baseUrl: typeof body.baseUrl === "string" ? body.baseUrl : undefined,
      model: typeof body.model === "string" ? body.model : undefined,
    });
    return NextResponse.json({ success: true, ...(await getLlmSettingsStatus()) });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "save_failed" },
      { status: 400 },
    );
  }
}

import { NextResponse, type NextRequest } from "next/server";
import { runRenewalProjectionBatch } from "@sangfor/business";
import { evaluatePersistedSessionFromRequest } from "@/lib/auth/persisted-session";

export async function POST(req: NextRequest) {
  try {
    const session = await evaluatePersistedSessionFromRequest(req);
    if (!session.ok) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const result = await runRenewalProjectionBatch({ now: new Date() });
    return NextResponse.json(result, { status: 200 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500 });
  }
}

import {
  connectMockOutlook,
  getPortalOverview,
  listPortalTasks,
  syncMockMail,
} from "@sangfor/business";
import { NextResponse } from "next/server";
import { apiError, assertApiAccess } from "@/lib/api-auth";

export async function GET() {
  try {
    const [overview, tasks] = await Promise.all([
      getPortalOverview(),
      listPortalTasks(),
    ]);
    return NextResponse.json({ overview, tasks });
  } catch (error) {
    return apiError("portal_failed", error, { status: 500 });
  }
}

export async function POST(request: Request) {
  const denied = assertApiAccess(request);
  if (denied) return denied;
  try {
    const body = await request.json();
    const action = body.action as string;
    if (action === "connect-outlook") {
      const account = await connectMockOutlook(body.projectSlug);
      return NextResponse.json({ account });
    }
    if (action === "sync-mail") {
      const messages = await syncMockMail(body.accountId);
      return NextResponse.json({ messages });
    }
    return NextResponse.json({ error: "unknown_action" }, { status: 400 });
  } catch (error) {
    return apiError("portal_action_failed", error, { status: 400 });
  }
}

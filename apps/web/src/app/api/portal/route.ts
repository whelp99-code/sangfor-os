import {
  connectMockOutlook,
  getPortalOverview,
  listPortalTasks,
  syncMockMail,
} from "@ai-portal/automation";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const [overview, tasks] = await Promise.all([
      getPortalOverview(),
      listPortalTasks(),
    ]);
    return NextResponse.json({ overview, tasks });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "portal_failed" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
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
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "portal_action_failed" },
      { status: 400 },
    );
  }
}

import { createPullRequestForRun, syncPullRequestCi } from "@sangfor/business";
import { NextResponse } from "next/server";
import { apiError, assertApiAccess } from "@/lib/api-auth";

export async function POST(request: Request) {
  const denied = assertApiAccess(request);
  if (denied) return denied;
  try {
    const body = await request.json();
    const { commandRunId, title } = body as { commandRunId: string; title: string };
    const pr = await createPullRequestForRun(commandRunId, title);
    return NextResponse.json({ pullRequest: pr }, { status: 201 });
  } catch (error) {
    return apiError("pr_failed", error, { status: 400 });
  }
}

export async function PATCH(request: Request) {
  const denied = assertApiAccess(request);
  if (denied) return denied;
  try {
    const body = await request.json();
    const { pullRequestId } = body as { pullRequestId: string };
    const pr = await syncPullRequestCi(pullRequestId);
    return NextResponse.json({ pullRequest: pr });
  } catch (error) {
    return apiError("sync_failed", error, { status: 400 });
  }
}

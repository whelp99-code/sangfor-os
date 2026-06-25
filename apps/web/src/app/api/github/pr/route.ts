import { createPullRequestForRun, syncPullRequestCi } from "@sangfor/business";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { commandRunId, title } = body as { commandRunId: string; title: string };
    const pr = await createPullRequestForRun(commandRunId, title);
    return NextResponse.json({ pullRequest: pr }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "pr_failed" },
      { status: 400 },
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const { pullRequestId } = body as { pullRequestId: string };
    const pr = await syncPullRequestCi(pullRequestId);
    return NextResponse.json({ pullRequest: pr });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "sync_failed" },
      { status: 400 },
    );
  }
}
